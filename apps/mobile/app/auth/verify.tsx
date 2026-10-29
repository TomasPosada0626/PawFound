import * as Haptics from "expo-haptics";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { maskEmail } from "@/domain/privacy";
import { safeNext } from "@/hooks/useAuthGate";
import { useNow } from "@/hooks/useNow";
import { countdown } from "@/i18n/format";
import { authErrorMessage } from "@/features/authErrors";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { DEMO_CODE } from "@/services/mockBackend";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const LENGTH = 6;

/** Verificación SMS (docs/flujos/onboarding-login-registro.md §3). Otorga la insignia azul. */
export default function VerifyScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  useNow(1000);

  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resends, setResends] = useState(0);
  const inputs = useRef<(TextInput | null)[]>([]);

  // Si se llega sin un código pendiente (p. ej. desde el aviso de "verifica tu correo"), se envía uno.
  useEffect(() => {
    if (user && !user.verified && !state.verification) void backend.sendVerificationCode().catch(() => {});
  }, [backend, user, state.verification]);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next } }} />;

  const code = digits.join("");
  const wait = backend.secondsUntilResend();

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    setError(null);
    if (clean.length > 1) {
      // Pegado o autocompletado del código: reparte los dígitos desde esta casilla.
      const next = [...digits];
      clean
        .slice(0, LENGTH - index)
        .split("")
        .forEach((d, i) => (next[index + i] = d));
      setDigits(next);
      inputs.current[Math.min(LENGTH - 1, index + clean.length)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const verify = async () => {
    setLoading(true);
    try {
      await backend.verifyCode(code);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(t("auth.verifiedToast"));
      // Siguiente paso del registro: activar las alertas (opcional, con su porqué).
      router.replace({ pathname: "/auth/alerts", params: { next } });
    } catch (e) {
      const err = e instanceof BackendError ? e : new BackendError("unknown");
      setError(
        err.code === "wrong_code"
          ? t("errors.wrong_code", { count: Number(err.params.count) })
          : err.code === "locked"
            ? t("errors.locked", { minutes: Number(err.params.minutes) })
            : err.code === "expired"
              ? t("errors.expired")
              : authErrorMessage(err.code, t),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setDigits(Array(LENGTH).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await backend.resendCode();
      setResends((n) => n + 1);
      setError(null);
      toast(t("auth.resent"), "info");
    } catch {
      toast(t("errors.unknown"), "error");
    }
  };

  return (
    <AuthLayout
      title={t("auth.verifyTitle")}
      subtitle={t("auth.verifySubtitle", { email: maskEmail(user.email) })}
      showBack
      testID="verify-screen"
    >
      <View className="flex-row justify-between gap-2">
        {digits.map((d, i) => (
          <TextInput
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={d}
            onChangeText={(v) => setDigit(i, v)}
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
            }}
            accessibilityLabel={t("auth.digitLabel", { index: i + 1 })}
            keyboardType="number-pad"
            maxLength={i === 0 ? LENGTH : 1}
            autoComplete={i === 0 ? "sms-otp" : "off"}
            textContentType={i === 0 ? "oneTimeCode" : "none"}
            autoFocus={i === 0}
            selectTextOnFocus
            className={`h-14 min-w-[44px] flex-1 rounded-2xl border-[1.5px] bg-surface text-center font-extrabold text-2xl text-ink ${error ? "border-danger" : d ? "border-primary-strong" : "border-border"}`}
            testID={`otp-${i}`}
          />
        ))}
      </View>
      {error ? (
        <Text
          variant="caption"
          tone="danger"
          className="mt-2 text-center"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          testID="otp-error"
        >
          {error}
        </Text>
      ) : null}

      <View className="mt-5">
        <Button
          label={t("auth.verify")}
          onPress={() => void verify()}
          loading={loading}
          disabled={code.length < LENGTH}
          testID="verify-submit"
        />
      </View>

      <View className="mt-4 items-center gap-1">
        {wait > 0 ? (
          <Text variant="caption" accessibilityLiveRegion="polite">
            {t("auth.resendIn", { time: countdown(wait) })}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => void resend()}
            className="min-h-[48px] justify-center"
            testID="resend"
          >
            <Text variant="bodyStrong" tone="primary">
              {t("auth.resend")}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="link"
          onPress={() => router.replace({ pathname: "/auth/phone", params: { next } })}
          className="min-h-[48px] justify-center"
        >
          <Text variant="captionStrong" tone="primary">
            {t("auth.changeNumber")}
          </Text>
        </Pressable>
        {resends >= 2 ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/settings/support")}
            className="min-h-[48px] justify-center"
          >
            <Text variant="captionStrong" style={{ color: colors.muted }}>
              {t("auth.noSms")}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="mt-3">
        <Banner icon="flask-outline" body={t("auth.demoCode", { code: DEMO_CODE })} />
      </View>
    </AuthLayout>
  );
}
