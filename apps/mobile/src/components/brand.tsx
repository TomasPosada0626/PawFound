import { View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from "react-native-svg";

import { useI18n } from "@/i18n/I18nProvider";

import { Text } from "./ui/Text";

/**
 * Isotipo simplificado: pin de ubicación con huella, en el degradado teal de la marca
 * (assets/brand/logo.png). Vectorial para verse nítido en cualquier densidad.
 */
export function LogoMark({ size = 96 }: { size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size * 1.18} viewBox="0 0 100 118">
        <Defs>
          <LinearGradient id="pin" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2BD4AE" />
            <Stop offset="1" stopColor="#0E8A9A" />
          </LinearGradient>
        </Defs>
        <Ellipse cx="50" cy="112" rx="22" ry="4" fill="#0E7C6B" opacity={0.18} />
        <Path
          d="M50 2C24.6 2 4 22.2 4 47.2c0 27.6 29.5 50.7 41.5 60.6a7 7 0 0 0 9 0C66.5 97.9 96 74.8 96 47.2 96 22.2 75.4 2 50 2z"
          fill="url(#pin)"
        />
        <Ellipse cx="31" cy="34" rx="7.5" ry="10" fill="#FFFFFF" />
        <Ellipse cx="44.5" cy="24" rx="7.5" ry="10.5" fill="#FFFFFF" />
        <Ellipse cx="58.5" cy="24" rx="7.5" ry="10.5" fill="#FFFFFF" />
        <Ellipse cx="71" cy="34" rx="7.5" ry="10" fill="#FFFFFF" />
        <Path
          d="M51 46c-11 0-22 12.5-22 23 0 7 5.5 10 11 10 4.6 0 7.4-2 11-2s6.4 2 11 2c5.5 0 11-3 11-10 0-10.5-11-23-22-23z"
          fill="#FFFFFF"
        />
      </Svg>
    </View>
  );
}

/** "PawFound": "Paw" en tinta, "Found" en teal de marca (logotipo, exento de contraste WCAG). */
export function Wordmark({ size = 28 }: { size?: number }) {
  const { t } = useI18n();
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={t("common.appName")} className="flex-row">
      <Text variant="display" tone="ink" style={{ fontSize: size, lineHeight: size * 1.2 }} maxFontSizeMultiplier={1.2}>
        Paw
        <Text variant="display" style={{ fontSize: size, lineHeight: size * 1.2, color: "#1FA98F" }} maxFontSizeMultiplier={1.2}>
          Found
        </Text>
      </Text>
    </View>
  );
}

/** Huellas decorativas de fondo (como en los mockups). */
export function PawDecoration({
  size = 120,
  opacity = 0.06,
  className,
}: {
  size?: number;
  opacity?: number;
  className?: string;
}) {
  return (
    <View pointerEvents="none" className={className} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 100 100" opacity={opacity}>
        <Ellipse cx="22" cy="38" rx="9" ry="12" fill="#1FA98F" />
        <Ellipse cx="40" cy="22" rx="9" ry="12.5" fill="#1FA98F" />
        <Ellipse cx="60" cy="22" rx="9" ry="12.5" fill="#1FA98F" />
        <Ellipse cx="78" cy="38" rx="9" ry="12" fill="#1FA98F" />
        <Path
          d="M50 46c-13 0-26 15-26 27 0 8 6.5 12 13 12 5.5 0 8.7-2.4 13-2.4s7.5 2.4 13 2.4c6.5 0 13-4 13-12 0-12-13-27-26-27z"
          fill="#1FA98F"
        />
      </Svg>
    </View>
  );
}
