import { router } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewProps } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { Wordmark } from "./brand";
import { IconButton } from "./ui/IconButton";
import { cn, Text } from "./ui/Text";

/** Dos botones de tema (sol a la izquierda, luna a la derecha), como en login.png y Mapa.png. */
export function ThemeButton({ mode }: { mode: "light" | "dark" }) {
  const { t } = useI18n();
  const { scheme, setPreference } = useTheme();
  return (
    <IconButton
      icon={mode === "light" ? "sunny-outline" : "moon-outline"}
      label={mode === "light" ? t("common.lightMode") : t("common.darkMode")}
      selected={scheme === mode}
      onPress={() => setPreference(mode)}
      testID={`theme-${mode}`}
    />
  );
}

export function BackButton({ fallback = "/" }: { fallback?: string }) {
  const { t } = useI18n();
  return (
    <IconButton
      icon="chevron-back"
      label={t("common.back")}
      variant="surface"
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
      testID="back"
    />
  );
}

/** Encabezado: slot izquierdo, wordmark centrado, slot derecho. */
export function AppHeader({ left, right, title }: { left?: ReactNode; right?: ReactNode; title?: string }) {
  return (
    <View className="px-4 pb-1 pt-2">
      <View className="min-h-[52px] flex-row items-center justify-between">
        <View className="w-14 items-start">{left ?? <ThemeButton mode="light" />}</View>
        <Wordmark />
        <View className="w-14 items-end">{right ?? <ThemeButton mode="dark" />}</View>
      </View>
      {title ? (
        <Text variant="title" className="mt-1 text-center" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
    </View>
  );
}

type ScreenProps = {
  children: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  /** Deja espacio para la barra de pestañas flotante. */
  withTabBar?: boolean;
  contentClassName?: string;
  scrollProps?: ScrollViewProps;
  footer?: ReactNode;
  testID?: string;
};

export function Screen({
  children,
  header,
  scroll = true,
  withTabBar = false,
  contentClassName,
  scrollProps,
  footer,
  testID,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Con menú inferior: su alto y el del botón "+" (~110) más la barra del sistema, para que
  // nada quede debajo.
  const bottomSpace = withTabBar ? 120 + Math.max(insets.bottom, 10) : 32;
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.bg }} testID={testID}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {header}
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: bottomSpace }}
            showsVerticalScrollIndicator={false}
            {...scrollProps}
          >
            <View className={cn("mx-auto w-full max-w-[720px] px-4", contentClassName)}>{children}</View>
          </ScrollView>
        ) : (
          <View className={cn("flex-1", contentClassName)}>{children}</View>
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
