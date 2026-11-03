import { View } from "react-native";

import { formatRating, RATING_VISIBLE_FROM } from "@/domain/rating";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { Icon } from "./ui/Icon";
import { Text } from "./ui/Text";

/**
 * Estrella y promedio de una persona. Antes de RATING_VISIBLE_FROM calificaciones reales la estrella
 * va en gris y sin número: una sola nota no define a nadie. En el perfil propio dice cuántas faltan.
 */
export function RatingSummary({
  average,
  count,
  own,
  large,
  testID,
}: {
  average: number;
  count: number;
  own?: boolean;
  large?: boolean;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const goal = RATING_VISIBLE_FROM;
  const visible = count >= goal;
  const pending = own
    ? count > 0
      ? t("rating.pendingOwnSome", { count, goal })
      : t("rating.pendingOwn", { goal })
    : t("rating.pending", { goal });
  const value = formatRating(average, locale);
  return (
    <View
      className="flex-row flex-wrap items-center gap-1"
      accessible
      accessibilityLabel={visible ? t("rating.label", { value, count }) : pending}
      testID={testID}
    >
      <Icon name={visible ? "star" : "star-outline"} size={large ? 22 : 15} color={visible ? "#F5A524" : colors.muted} />
      {visible ? (
        <>
          <Text variant={large ? "heading" : "captionStrong"}>{value}</Text>
          <Text variant="caption">{t("profile.ratingCount", { count })}</Text>
        </>
      ) : (
        <Text variant="caption" tone="muted">
          {pending}
        </Text>
      )}
    </View>
  );
}
