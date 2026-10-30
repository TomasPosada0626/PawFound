import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { BackendError, type SocialProvider } from "@/services/backendTypes";
import { useBackend } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./ui/Icon";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

const PROVIDERS: {
  key: SocialProvider;
  icon: IconName;
  color: string | null;
  label: "auth.google";
}[] = [{ key: "google", icon: "logo-google", color: "#4285F4", label: "auth.google" }];

/**
 * Entrar con Google: el proveedor ya confirmó el correo, así que la cuenta llega verificada
 * (insignia azul) sin pedir el código de 6 dígitos. Mientras no esté configurado, avisa que
 * llega pronto (antes decía "sin conexión").
 */
export function SocialButtons({ next }: { next: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const toast = useToast();
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  const signIn = async (provider: SocialProvider) => {
    setBusy(provider);
    try {
      await backend.loginWithProvider(provider);
      router.replace(next as never);
    } catch (e) {
      if (e instanceof BackendError && e.code === "provider_unavailable") toast(t("auth.googleSoon"), "info");
      else toast(t("errors.network"), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="gap-3">
      {PROVIDERS.map((p) => (
        <Pressable
          key={p.key}
          accessibilityRole="button"
          accessibilityLabel={t(p.label)}
          accessibilityState={{ busy: busy === p.key }}
          disabled={busy !== null}
          onPress={() => void signIn(p.key)}
          className="min-h-[54px] flex-row items-center justify-center gap-3 rounded-2xl border border-border bg-surface px-4 active:opacity-80"
          testID={`social-${p.key}`}
        >
          {busy === p.key ? (
            <ActivityIndicator color={colors.primaryStrong} />
          ) : (
            <Icon name={p.icon} size={22} color={p.color ?? colors.ink} />
          )}
          <Text variant="subheading">{t(p.label)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
