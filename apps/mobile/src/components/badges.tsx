import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

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
  new_member: { icon: "sparkles", from: "#7ED957", to: "#2E9E4F" },
};

/** Lo que cambia con el nivel: cada uno se ve claramente mejor que el anterior. */
export type TierLook = {
  /** Degradado del marco metálico, de claro a oscuro. */
  frame: string[];
  /** Borde y detalles del marco. */
  edge: string;
  /** Estrellas en la placa de abajo (la leyenda no lleva: la corona ya lo dice). */
  stars: number;
  /** Cintas detrás de la medalla, desde plata. */
  ribbon: boolean;
  /** Laureles alrededor, desde oro. */
  laurel?: string;
  gem?: boolean;
  crown?: boolean;
  /** Rayos de sol detrás: solo la leyenda. */
  rays?: boolean;
  sparkles?: boolean;
};

const BRONZE: TierLook = { frame: ["#F3C08D", "#B06A2C", "#7A4214"], edge: "#5E300C", stars: 1, ribbon: false };
const SILVER: TierLook = { frame: ["#FFFFFF", "#C3CED9", "#7C8B9B"], edge: "#56636F", stars: 2, ribbon: true };
const GOLD: TierLook = { frame: ["#FFF6B8", "#F5C531", "#B7780A"], edge: "#8A5700", stars: 3, ribbon: true, laurel: "#E8A90E" };
const PLATINUM: TierLook = {
  frame: ["#FFFFFF", "#BDF0FF", "#5AB7D6"],
  edge: "#2F7E99",
  stars: 3,
  ribbon: true,
  laurel: "#9EE3F5",
  gem: true,
};
const LEGEND: TierLook = {
  frame: ["#FFF3A6", "#FF7AB6", "#8A4DFF"],
  edge: "#5B22C9",
  stars: 0,
  ribbon: true,
  laurel: "#FFD34D",
  crown: true,
  rays: true,
  sparkles: true,
};
/** Insignias de un solo nivel ya obtenidas: marco claro, sin adornos de nivel. */
const PLAIN = { frame: ["#FFFFFF", "#E8EEF4", "#B4C1CE"], edge: "#7C8B9B" };

/** Bronce, plata, oro y leyenda. "Popular" tiene un nivel más (platino) antes de la leyenda. */
export function tierLook(id: BadgeId, tier: BadgeTier): TierLook | null {
  if (tier === 0) return null;
  if (id === "protector") return LEGEND;
  if (id === "popular") return [BRONZE, SILVER, GOLD, PLATINUM, LEGEND][tier - 1] ?? LEGEND;
  if (BADGE_RULES[id].thresholds.length === 1) return null;
  return [BRONZE, SILVER, GOLD][tier - 1] ?? GOLD;
}

/** Color que representa al nivel, para las etiquetas de texto. */
function tierColor(id: BadgeId, tier: BadgeTier) {
  return tierLook(id, tier)?.frame[1] ?? "#A7B6C6";
}

/** Estrella de `points` puntas. */
function starPath(cx: number, cy: number, outer: number, inner: number, points = 5) {
  const parts = Array.from({ length: points * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${parts.join(" L")} Z`;
}

/** Hexágono de radio `r` centrado en (50, 50), con la punta arriba. */
function hexPath(r: number) {
  const points = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${points.join(" L")} Z`;
}

export const CATEGORY_ORDER: BadgeCategory[] = ["identity", "help", "reunions", "community"];

const EDGE = hexPath(47);
const FRAME = hexPath(45);
const INNER_SHADOW = hexPath(36.5);
const FACE = hexPath(35);
const SHINE = "M22 33 L50 15 L78 33 L78 42 Q50 30 22 50 Z";
const RIBBON_LEFT = "M30 72 L22 104 L31 98 L37 107 L44 78 Z";
const RIBBON_RIGHT = "M70 72 L78 104 L69 98 L63 107 L56 78 Z";
const CROWN = "M34 6 L31 -10 L41 -2 L50 -13 L59 -2 L69 -10 L66 6 Z";
const GEM = "M50 -1 L57 5 L50 13 L43 5 Z";
const GEM_FACET = "M50 -1 L53 5 L50 13 Z";
const SPARKLES = [
  [100, 12, 6.5],
  [-2, 22, 5],
  [104, 78, 5],
  [-4, 74, 6],
].map(([x, y, r]) => starPath(x as number, y as number, r as number, (r as number) / 3.6, 4));
/** Margen alrededor de la medalla para que quepan la corona, las cintas y los destellos. */
const VIEW_BOX = "-10 -14 120 120";

/** Rayos de sol de la leyenda: 16 rayos desde el centro. */
const RAYS = Array.from({ length: 16 }, (_, k) => {
  const a1 = (Math.PI * 2 * k) / 16;
  const a2 = a1 + Math.PI / 16;
  const p = (a: number) => `${(50 + 62 * Math.cos(a)).toFixed(1)} ${(50 + 62 * Math.sin(a)).toFixed(1)}`;
  return `M50 50 L${p(a1)} L${p(a2)} Z`;
}).join(" ");

/** Laureles: dos tallos curvos con hojas a lo largo, a cada lado de la medalla. */
const LAUREL = (() => {
  const R = 50;
  const cy = 52;
  const at = (deg: number, r = R) => {
    const a = (deg * Math.PI) / 180;
    return [50 + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const [x0, y0] = at(110);
  const [x1, y1] = at(205);
  const stems = [
    `M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`,
    `M${(100 - x0).toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 0 ${(100 - x1).toFixed(1)} ${y1.toFixed(1)}`,
  ];
  const leaves: { cx: number; cy: number; rot: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const deg = 116 + k * 16;
    const tangent = deg + 125;
    for (const [px, py, extra] of [
      [...at(deg, R + 3), 0],
      [...at(deg, R - 3.5), -70],
    ] as const) {
      leaves.push({ cx: px, cy: py, rot: tangent + extra });
      leaves.push({ cx: 100 - px, cy: py, rot: -(tangent + extra) });
    }
  }
  return { stems, leaves };
})();

/** Rayos de la leyenda que giran despacio (solo en la celebración y si no se pidió reducir movimiento). */
function SpinningRays({ size, gradientId }: { size: number; gradientId: string }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (live) setReduceMotion(reduce);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 24000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ position: "absolute", width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size} viewBox={VIEW_BOX}>
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <Stop offset="0.3" stopColor="#FFE27A" stopOpacity={1} />
            <Stop offset="0.75" stopColor="#FF9AC8" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#B98CFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Path d={RAYS} fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Medalla de una insignia. Sin obtener: gris con candado. Cada nivel suma algo y se ve mejor:
 * bronce (marco y una estrella), plata (cintas), oro (laureles y tres estrellas), platino (gema) y
 * leyenda (rayos, corona y destellos). `animated` hace girar los rayos de la leyenda.
 */
export function BadgeHex({
  id,
  size = 64,
  tier = 1,
  animated = false,
}: {
  id: BadgeId;
  size?: number;
  tier?: BadgeTier;
  animated?: boolean;
}) {
  const badge = BADGES[id];
  const locked = tier === 0;
  const look = tierLook(id, tier);
  const from = locked ? "#CBD5DF" : badge.from;
  const to = locked ? "#97A6B5" : badge.to;
  const frame = look?.frame ?? PLAIN.frame;
  const edge = locked ? "#8C9AA8" : (look?.edge ?? PLAIN.edge);
  const key = `${id}-${tier}`;
  const ids = { fill: `fill-${key}`, frame: `frame-${key}`, rays: `rays-${key}` };
  const stars = look?.stars ?? 0;
  const plaqueWidth = 12 + stars * 11;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      {look?.rays && animated ? <SpinningRays size={size} gradientId={`${ids.rays}-spin`} /> : null}
      <Svg width={size} height={size} viewBox={VIEW_BOX} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id={ids.fill} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
          <LinearGradient id={ids.frame} x1="0.15" y1="0" x2="0.85" y2="1">
            {frame.map((color, i) => (
              <Stop key={`${color}-${i}`} offset={String(i / (frame.length - 1))} stopColor={color} />
            ))}
          </LinearGradient>
          {look?.rays && !animated ? (
            <RadialGradient id={ids.rays} cx="50%" cy="50%" r="50%">
              <Stop offset="0.3" stopColor="#FFE27A" stopOpacity={1} />
              <Stop offset="0.75" stopColor="#FF9AC8" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#B98CFF" stopOpacity={0} />
            </RadialGradient>
          ) : null}
        </Defs>
        {look?.rays && !animated ? <Path d={RAYS} fill={`url(#${ids.rays})`} /> : null}
        {look?.rays ? <Circle cx={50} cy={50} r={46} fill="#C77DFF" opacity={0.22} /> : null}
        {look?.ribbon ? (
          <G>
            <Path d={RIBBON_LEFT} fill={look.rays ? "#8A4DFF" : to} />
            <Path d={RIBBON_RIGHT} fill={look.rays ? "#8A4DFF" : to} />
            <Path d={RIBBON_LEFT} fill="#000000" opacity={0.12} />
          </G>
        ) : null}
        {look?.laurel ? (
          <G fill={look.laurel} stroke={look.edge} strokeWidth={0.7}>
            {LAUREL.stems.map((d) => (
              <Path key={d} d={d} fill="none" strokeWidth={1.6} />
            ))}
            {LAUREL.leaves.map((leaf, i) => (
              <Ellipse
                key={i}
                cx={leaf.cx}
                cy={leaf.cy}
                rx={2.6}
                ry={5.6}
                transform={`rotate(${leaf.rot.toFixed(1)} ${leaf.cx.toFixed(1)} ${leaf.cy.toFixed(1)})`}
              />
            ))}
          </G>
        ) : null}
        {/* Marco metálico con bisel: borde oscuro, marco con degradado y una sombra interior. */}
        <Path d={EDGE} fill={edge} stroke={edge} strokeWidth={2} strokeLinejoin="round" />
        <Path d={FRAME} fill={locked ? "#E3E9EF" : `url(#${ids.frame})`} />
        <Path d={INNER_SHADOW} fill={edge} opacity={0.55} />
        <Path d={FACE} fill={`url(#${ids.fill})`} />
        <Path d={SHINE} fill="#FFFFFF" opacity={locked ? 0.12 : 0.22} />
        <Path d={FACE} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.4} />
        {stars ? (
          <G>
            <Path
              d={`M${50 - plaqueWidth / 2 - 5} 89 L${50 - plaqueWidth / 2} 95 L${50 - plaqueWidth / 2 - 5} 101 L${50 + plaqueWidth / 2 + 5} 101 L${50 + plaqueWidth / 2} 95 L${50 + plaqueWidth / 2 + 5} 89 Z`}
              fill={edge}
            />
            <Rect
              x={50 - plaqueWidth / 2}
              y={88}
              width={plaqueWidth}
              height={14}
              rx={3}
              fill={`url(#${ids.frame})`}
              stroke={edge}
              strokeWidth={1.2}
            />
            {Array.from({ length: stars }, (_, i) => (
              <Path
                key={i}
                d={starPath(50 + (i - (stars - 1) / 2) * 11, 95.3, 5, 2.2)}
                fill="#FFFFFF"
                stroke={edge}
                strokeWidth={0.9}
              />
            ))}
          </G>
        ) : null}
        {look?.gem ? (
          <G>
            <Path d={GEM} fill="#E9FBFF" stroke="#2F7E99" strokeWidth={1.2} />
            <Path d={GEM_FACET} fill="#9EE3F5" />
          </G>
        ) : null}
        {look?.crown ? (
          <G>
            <Path d={CROWN} fill="#FFD84D" stroke="#B87400" strokeWidth={1.6} strokeLinejoin="round" />
            <Circle cx={50} cy={-1} r={2.6} fill="#FF5FA2" />
            <Circle cx={40} cy={2} r={1.7} fill="#8A4DFF" />
            <Circle cx={60} cy={2} r={1.7} fill="#8A4DFF" />
          </G>
        ) : null}
        {look?.sparkles ? SPARKLES.map((d) => <Path key={d} d={d} fill="#FFF3A6" />) : null}
      </Svg>
      {/* El centro de la medalla está un poco más abajo que el centro de la vista (viewBox). */}
      <View style={{ transform: [{ translateY: size * 0.033 }] }}>
        <Icon name={locked ? "lock-closed" : badge.icon} size={size * 0.3} color="#FFFFFF" />
      </View>
    </View>
  );
}

export function tierLabelKey(id: BadgeId, tier: BadgeTier) {
  if (id === "protector" || (id === "popular" && tier >= 5)) return "badgesHow.legend" as const;
  if (id === "popular") return `badgesHow.popularTier${Math.max(1, tier) as 1 | 2 | 3 | 4}` as const;
  return `badgesHow.tier${Math.max(1, Math.min(tier, 3)) as 1 | 2 | 3}` as const;
}

/** "Protector animal" tiene un solo nivel, pero se muestra como "Leyenda". */
function showsTier(id: BadgeId, maxTier: number) {
  return maxTier > 1 || id === "protector";
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
