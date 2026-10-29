import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";

import { formatDistance } from "@/domain/geo";
import {
  GROWTH_STEP_MIN,
  growthSnapshot,
  offsetMinutes,
  PREVIEW_OFFSETS_H,
  projection,
  type LifeCircleProfile,
} from "@/domain/lifeCircle";
import type { CaseKind, PetCase } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

import { Chip } from "./ui/Controls";
import { Icon } from "./ui/Icon";
import { Text } from "./ui/Text";

/**
 * Anillos concéntricos que crecen con el tiempo, con una huella al centro: explica de un
 * vistazo que el círculo de vida se amplía. Tamaños proporcionales a los metros reales.
 */
export function LifeCircleDiagram({
  profile,
  kind = "lost",
  size = 168,
  highlightIndex = 0,
}: {
  profile: LifeCircleProfile;
  kind?: CaseKind;
  size?: number;
  highlightIndex?: number;
}) {
  const steps = projection(profile, PREVIEW_OFFSETS_H);
  const max = steps[steps.length - 1]?.meters ?? 1;
  const color = statusColor[kind];
  const half = size / 2;
  const minR = size * 0.14;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {[...steps].reverse().map((step, reversedIndex) => {
          const index = steps.length - 1 - reversedIndex;
          const r = minR + (half - 4 - minR) * (step.meters / max);
          const active = index === highlightIndex;
          return (
            <Circle
              key={step.hours}
              cx={half}
              cy={half}
              r={r}
              stroke={color}
              strokeOpacity={active ? 1 : 0.35 + 0.1 * (steps.length - index)}
              strokeWidth={active ? 2.5 : 1.5}
              strokeDasharray={active ? "7 5" : "3 6"}
              fill={color}
              fillOpacity={active ? 0.16 : 0.04}
            />
          );
        })}
        <G transform={`translate(${half - 16} ${half - 16}) scale(0.32)`}>
          <Ellipse cx="22" cy="38" rx="9" ry="12" fill={color} />
          <Ellipse cx="40" cy="22" rx="9" ry="12.5" fill={color} />
          <Ellipse cx="60" cy="22" rx="9" ry="12.5" fill={color} />
          <Ellipse cx="78" cy="38" rx="9" ry="12" fill={color} />
          <Path
            d="M50 46c-13 0-26 15-26 27 0 8 6.5 12 13 12 5.5 0 8.7-2.4 13-2.4s7.5 2.4 13 2.4c6.5 0 13-4 13-12 0-12-13-27-26-27z"
            fill={color}
          />
        </G>
      </Svg>
    </View>
  );
}

/** Leyenda accesible del diagrama: "Al publicar 250 m · En 5 min 960 m · …". */
export function LifeCircleLegend({ profile }: { profile: LifeCircleProfile }) {
  const { t, locale } = useI18n();
  return (
    <View className="flex-1 gap-1.5">
      {projection(profile, PREVIEW_OFFSETS_H).map((p) => (
        <View key={p.hours} className="flex-row items-center justify-between gap-2">
          <Text variant="caption" tone="body">
            {p.hours === 0 ? t("report.projectionNow") : t("report.projectionAt", { minutes: offsetMinutes(p.hours) })}
          </Text>
          <Text variant="captionStrong" tone="primary">
            {formatDistance(p.meters, locale)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Tarjeta del detalle: radio vigente, cuánto crece en la próxima hora, progreso hacia el
 * máximo y una línea de tiempo que previsualiza el círculo en el mapa (+5, +15 y +30 min).
 */
export function LifeCircleCard({
  pet,
  now,
  previewHours,
  onPreview,
}: {
  pet: PetCase;
  now: Date;
  previewHours: number;
  onPreview: (hours: number) => void;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const g = growthSnapshot(pet, now);
  const color = statusColor[pet.kind];
  const highlight = Math.max(0, PREVIEW_OFFSETS_H.indexOf(previewHours as (typeof PREVIEW_OFFSETS_H)[number]));

  return (
    <View className="rounded-3xl border border-border/60 bg-surface p-4 shadow-sm shadow-black/5" testID="life-circle-card">
      <View className="flex-row items-center gap-2">
        <Icon name="radio-button-on" size={22} color={color} />
        <Text variant="subheading" accessibilityRole="header" className="flex-1">
          {t("lifeCircle.title")}
        </Text>
      </View>
      <Text variant="caption" tone="body" className="mt-1">
        {t("lifeCircle.body")}
      </Text>

      <View className="mt-3 flex-row items-center gap-4">
        <LifeCircleDiagram profile={g.profile} kind={pet.kind} size={120} highlightIndex={highlight} />
        <View className="flex-1 gap-1">
          <Text variant="title" tone="primary" accessibilityLiveRegion="polite">
            {formatDistance(g.current, locale)}
          </Text>
          <Text variant="caption" tone="body">
            {g.atCap
              ? t("lifeCircle.atCap", {
                  distance: formatDistance(g.cap, locale),
                })
              : t("lifeCircle.growing", {
                  distance: formatDistance(g.nextGrowth, locale),
                  minutes: GROWTH_STEP_MIN,
                })}
          </Text>
          <View
            className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-alt"
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t("lifeCircle.ofMax", {
              pct: g.pctOfCap,
              distance: formatDistance(g.cap, locale),
            })}
            accessibilityValue={{ min: 0, max: 100, now: g.pctOfCap }}
          >
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.max(4, g.pctOfCap)}%`,
                backgroundColor: color,
              }}
            />
          </View>
          <Text variant="label" tone="muted">
            {t("lifeCircle.ofMax", {
              pct: g.pctOfCap,
              distance: formatDistance(g.cap, locale),
            })}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2" accessibilityRole="tablist">
        {PREVIEW_OFFSETS_H.map((h) => (
          <Chip
            key={h}
            label={h === 0 ? t("lifeCircle.now") : t("lifeCircle.plusMinutes", { minutes: offsetMinutes(h) })}
            selected={previewHours === h}
            onPress={() => onPreview(h)}
            testID={`preview-${offsetMinutes(h)}`}
          />
        ))}
      </View>
      <View className="mt-3 flex-row items-start gap-2">
        <Icon name="eye-outline" size={16} color={colors.muted} />
        <Text variant="caption" className="flex-1">
          {t("lifeCircle.restart")}
        </Text>
      </View>
    </View>
  );
}
