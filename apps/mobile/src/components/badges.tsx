import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { useI18n } from "@/i18n/I18nProvider";
import type { BadgeId } from "@/services/selectors";

import { Icon, type IconName } from "./ui/Icon";
import { Text } from "./ui/Text";

/** Catálogo visual: hexágono con degradado + ícono blanco (Pefil.png). Orden = orden de logro típico. */
export const BADGES: Record<BadgeId, { icon: IconName; from: string; to: string }> = {
  verified: { icon: "shield-checkmark", from: "#1F8A6B", to: "#0B4F3C" },
  first_report: { icon: "megaphone", from: "#2BC4A6", to: "#0E7C6B" },
  first_rescue: { icon: "paw", from: "#F06277", to: "#C8283D" },
  reunion: { icon: "home", from: "#8C6CF0", to: "#5B3CC4" },
  ten_reports: { icon: "ribbon", from: "#FF9A3D", to: "#D9480F" },
  community: { icon: "people", from: "#4C93F5", to: "#1D5FC9" },
};

export const BADGE_ORDER = Object.keys(BADGES) as BadgeId[];

const HEX = "M50 3 L91 26.5 L91 73.5 L50 97 L9 73.5 L9 26.5 Z";

export function BadgeHex({ id, size = 64, locked = false }: { id: BadgeId; size?: number; locked?: boolean }) {
  const badge = BADGES[id];
  const from = locked ? "#C9D3DC" : badge.from;
  const to = locked ? "#9AA8B6" : badge.to;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id={`g-${id}-${locked ? "l" : "e"}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Path d={HEX} fill={`url(#g-${id}-${locked ? "l" : "e"})`} stroke="#FFFFFF" strokeWidth={5} strokeLinejoin="round" />
        <Path
          d="M50 15 L80 32.5 L80 67.5 L50 85 L20 67.5 L20 32.5 Z"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity={0.35}
          strokeWidth={2}
        />
      </Svg>
      <Icon name={locked ? "lock-closed" : badge.icon} size={size * 0.36} color="#FFFFFF" />
    </View>
  );
}

/** Insignia con nombre debajo; anuncia nombre y estado a TalkBack. */
export function BadgeTile({ id, locked = false, size = 60 }: { id: BadgeId; locked?: boolean; size?: number }) {
  const { t } = useI18n();
  const name = t(`badges.${id}`);
  return (
    <View
      accessible
      accessibilityLabel={`${name}. ${locked ? `${t("badgesHow.locked")}: ${t(`badgesHow.${id}`)}` : t("badgesHow.earned")}`}
      className="w-[84px] items-center gap-1"
    >
      <BadgeHex id={id} locked={locked} size={size} />
      <Text variant="label" tone={locked ? "muted" : "body"} className="text-center" numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}
