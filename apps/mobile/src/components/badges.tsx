import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { BADGE_RULES, type BadgeCategory, type BadgeId, type BadgeProgress, type BadgeTier } from "@/domain/badges";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./ui/Icon";
import { Text } from "./ui/Text";

/** Catálogo visual: hexágono con degradado por insignia + ícono blanco (Pefil.png). */
export const BADGES: Record<BadgeId, { icon: IconName; from: string; to: string }> = {
  verified: { icon: "shield-checkmark", from: "#1F8A6B", to: "#0B4F3C" },
  reporter: { icon: "megaphone", from: "#2CCFC0", to: "#08807A" },
  rescuer: { icon: "paw", from: "#F25555", to: "#C81E1E" },
  eyes: { icon: "eye", from: "#38B6E8", to: "#1572A8" },
  paw_angel: { icon: "heart", from: "#A98BF5", to: "#6D4AD6" },
  reunion: { icon: "home", from: "#8C6CF0", to: "#4B2FB0" },
  spreader: { icon: "share-social", from: "#FF9A3D", to: "#D9480F" },
  community: { icon: "people", from: "#4C93F5", to: "#1D5FC9" },
};

/** El nivel se lee en el color del borde (bronce, plata, oro) y en las marcas inferiores. */
export const TIER_COLORS: Record<Exclude<BadgeTier, 0>, string> = { 1: "#C9813F", 2: "#A7B6C6", 3: "#F2B51D" };

export const CATEGORY_ORDER: BadgeCategory[] = ["identity", "help", "reunions", "community"];

const HEX = "M50 3 L91 26.5 L91 73.5 L50 97 L9 73.5 L9 26.5 Z";
const INNER_HEX = "M50 15 L80 32.5 L80 67.5 L50 85 L20 67.5 L20 32.5 Z";

export function tierLabelKey(tier: BadgeTier) {
  return `badgesHow.tier${Math.max(1, tier) as 1 | 2 | 3}` as const;
}

export function BadgeHex({ id, size = 64, tier = 1 }: { id: BadgeId; size?: number; tier?: BadgeTier }) {
  const badge = BADGES[id];
  const locked = tier === 0;
  const from = locked ? "#C9D3DC" : badge.from;
  const to = locked ? "#9AA8B6" : badge.to;
  const multiTier = BADGE_RULES[id].thresholds.length > 1;
  const gradientId = `g-${id}-${tier}`;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Path
          d={HEX}
          fill={`url(#${gradientId})`}
          stroke={locked || !multiTier ? "#FFFFFF" : TIER_COLORS[tier as 1 | 2 | 3]}
          strokeWidth={locked || !multiTier ? 5 : 7}
          strokeLinejoin="round"
        />
        <Path d={INNER_HEX} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={2} />
        {multiTier && !locked
          ? Array.from({ length: tier }, (_, i) => (
              <Circle key={i} cx={50 + (i - (tier - 1) / 2) * 9} cy={77} r={3.2} fill="#FFFFFF" />
            ))
          : null}
      </Svg>
      <View style={{ marginTop: multiTier && !locked ? -size * 0.08 : 0 }}>
        <Icon name={locked ? "lock-closed" : badge.icon} size={size * 0.34} color="#FFFFFF" />
      </View>
    </View>
  );
}

/** Insignia con nombre y nivel debajo; anuncia nombre, nivel y estado a TalkBack. */
export function BadgeTile({ progress, size = 60 }: { progress: BadgeProgress; size?: number }) {
  const { t } = useI18n();
  const name = t(`badges.${progress.id}`);
  const multiTier = progress.maxTier > 1;
  const status =
    progress.tier === 0
      ? `${t("badgesHow.locked")}: ${t(`badgesHow.${progress.id}`, { count: progress.next ?? 1 })}`
      : multiTier
        ? t(tierLabelKey(progress.tier))
        : t("badgesHow.earned");
  return (
    <View accessible accessibilityLabel={`${name}. ${status}`} className="w-[84px] items-center gap-1">
      <BadgeHex id={progress.id} tier={progress.tier} size={size} />
      <Text variant="label" tone={progress.tier === 0 ? "muted" : "body"} className="text-center" numberOfLines={2}>
        {name}
      </Text>
      {multiTier && progress.tier > 0 ? (
        <Text variant="caption" className="text-center">
          {t(tierLabelKey(progress.tier))}
        </Text>
      ) : null}
    </View>
  );
}

/** Fila del catálogo: insignia, cómo se gana el siguiente nivel y barra de progreso. */
export function BadgeProgressRow({ progress }: { progress: BadgeProgress }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const name = t(`badges.${progress.id}`);
  const goal = progress.next;
  const nextTier = (progress.tier + 1) as BadgeTier;
  const ratio = goal ? Math.min(1, progress.count / goal) : 1;
  const how = t(`badgesHow.${progress.id}`, { count: goal ?? progress.count });
  const multiTier = progress.maxTier > 1;
  const status =
    goal === null
      ? multiTier
        ? t("badgesHow.maxed")
        : t("badgesHow.earned")
      : t("badgesHow.progress", { count: progress.count, goal, tier: t(tierLabelKey(nextTier)) });
  return (
    <View
      className="flex-row items-center gap-4 border-b border-border py-3"
      accessible
      accessibilityLabel={`${name}. ${progress.tier > 0 && multiTier ? `${t(tierLabelKey(progress.tier))}. ` : ""}${how} ${status}`}
      testID={`badge-${progress.id}`}
    >
      <BadgeHex id={progress.id} tier={progress.tier} size={56} />
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Text variant="bodyStrong">{name}</Text>
          {progress.tier > 0 && multiTier ? (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: `${TIER_COLORS[progress.tier as 1 | 2 | 3]}33` }}
            >
              <Text variant="captionStrong">{t(tierLabelKey(progress.tier))}</Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption">{how}</Text>
        <View className="h-2 overflow-hidden rounded-full bg-surface-alt">
          <View
            style={{ width: `${ratio * 100}%`, backgroundColor: goal === null ? colors.primaryStrong : BADGES[progress.id].to }}
            className="h-2 rounded-full"
          />
        </View>
        <Text variant="caption" tone={goal === null ? "primary" : "muted"}>
          {status}
        </Text>
      </View>
    </View>
  );
}

/** Catálogo completo agrupado por categoría (identidad, ayuda, reencuentros, comunidad). */
export function BadgeCatalog({ progress }: { progress: BadgeProgress[] }) {
  const { t } = useI18n();
  return (
    <View className="pb-2">
      {CATEGORY_ORDER.map((category) => {
        const items = progress.filter((p) => BADGE_RULES[p.id].category === category);
        if (!items.length) return null;
        return (
          <View key={category} className="mb-2">
            <Text variant="label" tone="muted" accessibilityRole="header" className="mt-2 uppercase">
              {t(`badgesHow.cat_${category}`)}
            </Text>
            {items.map((p) => (
              <BadgeProgressRow key={p.id} progress={p} />
            ))}
          </View>
        );
      })}
      <Text variant="caption" className="mt-2">
        {t("badgesHow.fairPlay")}
      </Text>
    </View>
  );
}
