import { View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { Icon } from "./ui/Icon";
import { Text } from "./ui/Text";

/** Identifica el perfil de quien fundó PawFound. */
export function FounderTag() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-primary-soft px-3 py-1" testID="founder-tag">
      <Icon name="ribbon" size={14} color={colors.primaryStrong} />
      <Text variant="captionStrong" tone="primary">
        {t("common.founder")}
      </Text>
    </View>
  );
}
