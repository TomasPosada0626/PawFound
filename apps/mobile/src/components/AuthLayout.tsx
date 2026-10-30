import type { ReactNode } from "react";
import { View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";

import { LogoMark, Wordmark } from "./brand";
import { BackButton, Screen, ThemeButton } from "./layout";
import { Text } from "./ui/Text";

/** Marco común de login/registro/verificación (login.png, Registro.png). */
export function AuthLayout({
  title,
  subtitle,
  children,
  showBack = false,
  testID,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  showBack?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  return (
    <Screen
      testID={testID}
      header={
        <View className="flex-row items-center justify-between px-4 pt-2">
          {showBack ? <BackButton /> : <ThemeButton mode="light" />}
          <ThemeButton mode="dark" />
        </View>
      }
    >
      <View className="items-center">
        <LogoMark size={64} />
        <View className="mt-1">
          <Wordmark size={34} />
        </View>
        <View className="flex-row items-center gap-2">
          <View className="h-1.5 w-1.5 rounded-full bg-primary" />
          <Text variant="body" tone="body">
            {t("common.tagline")}
          </Text>
          <View className="h-1.5 w-1.5 rounded-full bg-primary" />
        </View>
      </View>
      <View className="mt-5 rounded-[32px] border border-border/60 bg-surface px-5 py-6 shadow-lg shadow-black/10">
        <Text variant="title" className="text-center" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" tone="muted" className="mb-4 mt-1 text-center">
            {subtitle}
          </Text>
        ) : (
          <View className="mb-4" />
        )}
        {children}
      </View>
    </Screen>
  );
}

/** Separador "o continúa con". */
export function OrDivider({ label }: { label: string }) {
  return (
    <View className="my-5 flex-row items-center gap-3">
      <View className="h-px flex-1 bg-border" />
      <Text variant="caption">{label}</Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}
