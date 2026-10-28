import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

import { BackButton, Screen } from "./layout";
import { Wordmark } from "./brand";
import { Icon, type IconName } from "./ui/Icon";
import { ConfirmSheet } from "./ui/Sheet";
import { cn, Text } from "./ui/Text";

export type SettingsSection = "personal" | "notifications" | "privacy" | "help";

const SECTIONS: { key: SettingsSection; icon: IconName; href: string }[] = [
  { key: "personal", icon: "person-outline", href: "/settings/edit-profile" },
  { key: "notifications", icon: "notifications-outline", href: "/settings/notifications" },
  { key: "privacy", icon: "shield-checkmark-outline", href: "/settings/privacy" },
  { key: "help", icon: "help-circle-outline", href: "/settings/support" },
];

/**
 * Ajustes con la navegación lateral de los mockups. En teléfonos angostos o con texto
 * ampliado (accesibilidad), la misma navegación pasa arriba como pestañas desplazables.
 */
export function SettingsLayout({
  section,
  title,
  children,
  right,
  showLogout = true,
}: {
  section: SettingsSection;
  title: string;
  children: ReactNode;
  right?: ReactNode;
  showLogout?: boolean;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const backend = useBackend();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const sidebar = width >= 380 && fontScale <= 1.15;

  const go = (href: string, key: SettingsSection) => {
    if (key !== section) router.replace(href as never);
  };
  const logout = async () => {
    setLogoutOpen(false);
    await writeJSON(STORAGE_KEYS.session, null);
    await backend.logout();
    router.replace("/");
  };

  const navItem = (s: (typeof SECTIONS)[number], compact: boolean) => {
    const active = s.key === section;
    return (
      <Pressable
        key={s.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={t(`settings.${s.key}`)}
        onPress={() => go(s.href, s.key)}
        className={cn(
          "min-h-[48px] flex-row items-center gap-2 rounded-2xl active:opacity-70",
          compact ? "px-4" : "px-2 py-3",
          active ? "bg-primary-soft" : compact ? "border border-border bg-surface" : "",
        )}
        testID={`settings-nav-${s.key}`}
      >
        <Icon name={s.icon} size={compact ? 18 : 22} color={active ? colors.primaryStrong : colors.muted} />
        <Text
          variant={compact ? "captionStrong" : "caption"}
          tone={active ? "primary" : "body"}
          className={compact ? "" : "flex-1"}
        >
          {t(`settings.${s.key}`)}
        </Text>
      </Pressable>
    );
  };

  const logoutItem = (
    <Pressable
      accessibilityRole="button"
      onPress={() => setLogoutOpen(true)}
      className="min-h-[48px] flex-row items-center gap-2 px-2 py-3 active:opacity-70"
      testID="settings-logout"
    >
      <Icon name="log-out-outline" size={22} color={colors.danger} />
      <Text variant="caption" tone="danger">
        {t("settings.logout")}
      </Text>
    </Pressable>
  );

  return (
    <Screen
      header={
        <View className="px-4 pt-2">
          <View className="min-h-[52px] flex-row items-center justify-between">
            <BackButton fallback="/profile" />
            <Wordmark />
            <View className="w-12 items-end">{right}</View>
          </View>
          <Text variant="heading" className="mb-2 text-center" accessibilityRole="header">
            {title}
          </Text>
        </View>
      }
      contentClassName="px-3"
    >
      {sidebar ? (
        <View className="flex-row gap-3">
          <View
            accessibilityRole="tablist"
            accessibilityLabel={t("settings.sections")}
            className="w-[30%] max-w-[200px] self-start rounded-3xl border border-border/60 bg-surface p-2"
          >
            {SECTIONS.map((s) => navItem(s, false))}
            {showLogout ? logoutItem : null}
          </View>
          <View className="flex-1 gap-3">{children}</View>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="tablist"
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          >
            {SECTIONS.map((s) => navItem(s, true))}
          </ScrollView>
          <View className="gap-3">{children}</View>
          {showLogout ? <View className="mt-3">{logoutItem}</View> : null}
        </>
      )}
      <ConfirmSheet
        visible={logoutOpen}
        title={t("settings.logoutConfirmTitle")}
        body={t("settings.logoutConfirmBody")}
        confirmLabel={t("settings.logout")}
        onConfirm={() => void logout()}
        onCancel={() => setLogoutOpen(false)}
      />
    </Screen>
  );
}

/** Tarjeta de sección dentro de ajustes. */
export function SettingsCard({
  title,
  subtitle,
  children,
  icon,
  tone,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  icon?: IconName;
  tone?: "danger";
}) {
  const { colors } = useTheme();
  return (
    <View className={cn("rounded-3xl border border-border/60 p-4", tone === "danger" ? "bg-lost-soft" : "bg-surface")}>
      {title ? (
        <View className="mb-1 flex-row items-center gap-2">
          {icon ? <Icon name={icon} size={20} color={tone === "danger" ? colors.danger : colors.primaryStrong} /> : null}
          <Text variant="subheading" tone={tone === "danger" ? "danger" : "ink"} accessibilityRole="header" className="flex-1">
            {title}
          </Text>
        </View>
      ) : null}
      {subtitle ? (
        <Text variant="caption" className="mb-2">
          {subtitle}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
