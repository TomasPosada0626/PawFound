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
  quick: { icon: "flash", from: "#FFC83D", to: "#D98A00" },
  protector: { icon: "star", from: "#F2B51D", to: "#B87400" },
  popular: { icon: "heart-circle", from: "#FF6B8B", to: "#C42D52" },
};

/** Lo que cambia con el nivel: cada uno se ve claramente mejor que el anterior. */
export type TierLook = {
  /** Degradado del borde. */
  ring: string[];
  ringWidth: number;
  innerColor: string;
  innerOpacity: number;
  innerWidth: number;
  /** Brillo sobre la mitad superior; 0 es sin brillo. */
  shine: number;
  /** Resplandor alrededor de la insignia. */
  halo?: string;
  top?: "star" | "crown";
  sparkles?: boolean;
};

const BRONZE: TierLook = {
  ring: ["#E8B07A", "#8F5522"],
  ringWidth: 5,
  innerColor: "#FFFFFF",
  innerOpacity: 0.25,
  innerWidth: 1.5,
  shine: 0,
};
const SILVER: TierLook = {
  ring: ["#FFFFFF", "#8E9DAD"],
  ringWidth: 6.5,
  innerColor: "#FFFFFF",
  innerOpacity: 0.5,
  innerWidth: 2,
  shine: 0.1,
};
const GOLD: TierLook = {
  ring: ["#FFF0A0", "#D99A0B"],
  ringWidth: 7.5,
  innerColor: "#FFE98A",
  innerOpacity: 0.9,
  innerWidth: 2.5,
  shine: 0.16,
  top: "star",
};
const PLATINUM: TierLook = {
  ring: ["#F0FDFF", "#45AFCF"],
  ringWidth: 8,
  innerColor: "#C9F4FF",
  innerOpacity: 0.95,
  innerWidth: 2.5,
  shine: 0.2,
  halo: "#7FDDF0",
  top: "star",
};
const LEGEND: TierLook = {
  ring: ["#FFE98A", "#FF5FA2", "#8A4DFF"],
  ringWidth: 9,
  innerColor: "#FFE98A",
  innerOpacity: 1,
  innerWidth: 3,
  shine: 0.24,
  halo: "#B56BF0",
  top: "crown",
  sparkles: true,
};

/** Bronce, plata, oro y leyenda. "Popular" tiene un nivel más antes de la leyenda. */
export function tierLook(id: BadgeId, tier: BadgeTier): TierLook | null {
  if (tier === 0) return null;
  if (id === "protector") return LEGEND;
  if (id === "popular") return [BRONZE, SILVER, GOLD, PLATINUM, LEGEND][tier - 1] ?? LEGEND;
  if (BADGE_RULES[id].thresholds.length === 1) return null;
  return [BRONZE, SILVER, GOLD][tier - 1] ?? GOLD;
}

/** Color que representa al nivel, para las etiquetas de texto. */
function tierColor(id: BadgeId, tier: BadgeTier) {
  return tierLook(id, tier)?.ring.at(-1) ?? "#A7B6C6";
}

/** Estrella de `points` puntas para adornar los niveles altos. */
function starPath(cx: number, cy: number, outer: number, inner: number, points = 5) {
  const parts = Array.from({ length: points * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${parts.join(" L")} Z`;
}

export const CATEGORY_ORDER: BadgeCategory[] = ["identity", "help", "reunions", "community"];

const HEX = "M50 3 L91 26.5 L91 73.5 L50 97 L9 73.5 L9 26.5 Z";
const INNER_HEX = "M50 15 L80 32.5 L80 67.5 L50 85 L20 67.5 L20 32.5 Z";
const SHINE = "M50 15 L80 32.5 L50 50 L20 32.5 Z";
const CROWN = "M37 9 L34 -7 L43 0 L50 -10 L57 0 L66 -7 L63 9 Z";
/** Margen alrededor del hexágono para que quepan el resplandor y la corona. */
const VIEW_BOX = "-10 -14 120 120";

export function tierLabelKey(id: BadgeId, tier: BadgeTier) {
  if (id === "protector" || (id === "popular" && tier >= 5)) return "badgesHow.legend" as const;
  if (id === "popular") return `badgesHow.popularTier${Math.max(1, tier) as 1 | 2 | 3 | 4}` as const;
  return `badgesHow.tier${Math.max(1, Math.min(tier, 3)) as 1 | 2 | 3}` as const;
}

/** "Protector animal" tiene un solo nivel, pero se muestra como "Leyenda". */
function showsTier(id: BadgeId, maxTier: number) {
  return maxTier > 1 || id === "protector";
}

export function BadgeHex({ id, size = 64, tier = 1 }: { id: BadgeId; size?: number; tier?: BadgeTier }) {
  const badge = BADGES[id];
  const locked = tier === 0;
  const from = locked ? "#C9D3DC" : badge.from;
  const to = locked ? "#9AA8B6" : badge.to;
  const look = tierLook(id, tier);
  // Las marcas cuentan el nivel; la leyenda ya se distingue por la corona.
  const dots = look && look !== LEGEND ? tier : 0;
  const gradientId = `g-${id}-${tier}`;
  const ringId = `r-${id}-${tier}`;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} viewBox={VIEW_BOX} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
          {look ? (
            <LinearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
              {look.ring.map((color, i) => (
                <Stop key={color} offset={String(i / (look.ring.length - 1))} stopColor={color} />
              ))}
            </LinearGradient>
          ) : null}
        </Defs>
        {look?.halo ? (
          <Path d={HEX} fill="none" stroke={look.halo} strokeOpacity={0.35} strokeWidth={15} strokeLinejoin="round" />
        ) : null}
        <Path
          d={HEX}
          fill={`url(#${gradientId})`}
          stroke={look ? `url(#${ringId})` : "#FFFFFF"}
          strokeWidth={look ? look.ringWidth : 5}
          strokeLinejoin="round"
        />
        {look?.shine ? <Path d={SHINE} fill="#FFFFFF" fillOpacity={look.shine} /> : null}
        <Path
          d={INNER_HEX}
          fill="none"
          stroke={look ? look.innerColor : "#FFFFFF"}
          strokeOpacity={look ? look.innerOpacity : 0.35}
          strokeWidth={look ? look.innerWidth : 2}
        />
        {Array.from({ length: dots }, (_, i) => (
          <Circle key={i} cx={50 + (i - (dots - 1) / 2) * 9} cy={77} r={3.2} fill="#FFFFFF" />
        ))}
        {look?.top === "star" ? (
          <Path d={starPath(50, 3, 10, 4.2)} fill={look.ring[0]} stroke={look.ring[1]} strokeWidth={1.5} />
        ) : null}
        {look?.top === "crown" ? (
          <>
            <Path d={CROWN} fill="#FFD84D" stroke="#B87400" strokeWidth={1.5} strokeLinejoin="round" />
            <Circle cx={50} cy={4} r={2.4} fill="#FF5FA2" />
          </>
        ) : null}
        {look?.sparkles
          ? [
              [101, 14, 6],
              [-1, 20, 5],
              [103, 84, 5],
              [-3, 80, 6],
            ].map(([x, y, r]) => (
              <Path key={`${x}`} d={starPath(x as number, y as number, r as number, (r as number) / 3.5, 4)} fill="#FFE98A" />
            ))
          : null}
      </Svg>
      <View style={{ marginTop: dots ? -size * 0.07 : size * 0.02 }}>
        <Icon name={locked ? "lock-closed" : badge.icon} size={size * 0.3} color="#FFFFFF" />
      </View>
    </View>
  );
}

/** Insignia con nombre y nivel debajo; anuncia nombre, nivel y estado a TalkBack. */
export function BadgeTile({ progress, size = 60 }: { progress: BadgeProgress; size?: number }) {
  const { t } = useI18n();
  const name = t(`badges.${progress.id}`);
  const multiTier = showsTier(progress.id, progress.maxTier);
  const status =
    progress.tier === 0
      ? `${t("badgesHow.locked")}: ${t(`badgesHow.${progress.id}`, { count: progress.next ?? 1 })}`
      : multiTier
        ? t(tierLabelKey(progress.id, progress.tier))
        : t("badgesHow.earned");
  return (
    <View accessible accessibilityLabel={`${name}. ${status}`} className="w-[84px] items-center gap-1">
      <BadgeHex id={progress.id} tier={progress.tier} size={size} />
      <Text variant="label" tone={progress.tier === 0 ? "muted" : "body"} className="text-center" numberOfLines={2}>
        {name}
      </Text>
      {multiTier && progress.tier > 0 ? (
        <Text variant="caption" className="text-center">
          {t(tierLabelKey(progress.id, progress.tier))}
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
  const multiTier = showsTier(progress.id, progress.maxTier);
  const status =
    goal === null
      ? multiTier
        ? t(progress.id === "protector" ? "badgesHow.legend" : "badgesHow.maxed")
        : t("badgesHow.earned")
      : progress.id === "protector"
        ? t("badgesHow.locked")
        : t("badgesHow.progress", { count: progress.count, goal, tier: t(tierLabelKey(progress.id, nextTier)) });
  return (
    <View
      className="flex-row items-center gap-4 border-b border-border py-3"
      accessible
      accessibilityLabel={`${name}. ${progress.tier > 0 && multiTier ? `${t(tierLabelKey(progress.id, progress.tier))}. ` : ""}${how} ${status}`}
      testID={`badge-${progress.id}`}
    >
      <BadgeHex id={progress.id} tier={progress.tier} size={56} />
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Text variant="bodyStrong">{name}</Text>
          {progress.tier > 0 && multiTier ? (
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: `${tierColor(progress.id, progress.tier)}33` }}>
              <Text variant="captionStrong">{t(tierLabelKey(progress.id, progress.tier))}</Text>
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
