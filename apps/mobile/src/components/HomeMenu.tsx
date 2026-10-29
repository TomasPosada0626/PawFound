import { router } from "expo-router";
import { View } from "react-native";

import type { Locale } from "@/i18n/core";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme, type ThemePreference } from "@/theme/ThemeProvider";

import { Chip, Divider, ListRow } from "./ui/Controls";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";

/** Menú hamburguesa de Inicio: accesos rápidos, idioma y tema. */
export function HomeMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();

  const go = (href: string) => {
    onClose();
    router.push(href as never);
  };

  const themes: { key: ThemePreference; label: string }[] = [
    { key: "light", label: t("menu.themeLight") },
    { key: "dark", label: t("menu.themeDark") },
    { key: "system", label: t("menu.themeSystem") },
  ];
  const locales: { key: Locale; label: string }[] = [
    { key: "es", label: "Español" },
    { key: "en", label: "English" },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={t("menu.title")} testID="home-menu">
      <ListRow icon="document-text-outline" title={t("menu.myReports")} onPress={() => go("/list?filter=mine")} />
      <ListRow icon="heart-outline" tone="lost" title={t("menu.following")} onPress={() => go("/list?filter=following")} />
      <ListRow icon="list-outline" title={t("menu.nearbyList")} onPress={() => go("/list?filter=nearby")} />
      <ListRow icon="settings-outline" tone="neutral" title={t("menu.settings")} onPress={() => go("/settings/notifications")} />
      <ListRow icon="help-circle-outline" tone="blue" title={t("settings.help")} onPress={() => go("/settings/support")} />
      <Divider className="my-3" />
      <Text variant="captionStrong" className="mb-2">
        {t("menu.language")}
      </Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {locales.map((l) => (
          <Chip
            key={l.key}
            label={l.label}
            selected={locale === l.key}
            onPress={() => setLocale(l.key)}
            testID={`locale-${l.key}`}
          />
        ))}
      </View>
      <Text variant="captionStrong" className="mb-2">
        {t("menu.theme")}
      </Text>
      <View className="mb-2 flex-row flex-wrap gap-2">
        {themes.map((th) => (
          <Chip key={th.key} label={th.label} selected={preference === th.key} onPress={() => setPreference(th.key)} />
        ))}
      </View>
    </Sheet>
  );
}
