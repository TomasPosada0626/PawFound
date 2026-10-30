import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AuthLayout, OrDivider } from "@/components/AuthLayout";
import { SocialButtons } from "@/components/SocialButtons";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { validateLogin, type LoginForm } from "@/domain/validation";
import { safeNext } from "@/hooks/useAuthGate";
import { errorMessage } from "@/features/errorMessages";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/services/seed";
import { STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend } from "@/store/backend";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const gated = next !== "/";
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();

  const [form, setForm] = useState<LoginForm>({ identifier: "", password: "" });
  const [touched, setTouched] = useState<Partial<Record<keyof LoginForm, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errors = validateLogin(form);
  const fieldError = (key: keyof LoginForm) =>
    (touched[key] || submitted) && errors[key] ? t(`errors.${errors[key]}` as "errors.required") : undefined;

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;
    setLoading(true);
    try {
      const { needsVerification } = await backend.login(form.identifier, form.password);
      await writeJSON(STORAGE_KEYS.session, backend.getSnapshot().sessionUserId);
      if (needsVerification) router.replace({ pathname: "/auth/verify", params: { next } });
      else router.replace(next as never);
    } catch (error) {
      // Mensaje genérico: no revela si el correo existe (docs/flujos/onboarding-login-registro.md).
      setFormError(
        error instanceof BackendError && error.code === "invalid_credentials"
          ? t("errors.invalid_credentials")
          : errorMessage(error instanceof BackendError ? error.code : "unknown", t),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t("auth.loginTitle")} subtitle={t("auth.loginSubtitle")} showBack={gated} testID="login-screen">
      {gated ? (
        <View className="mb-4">
          <Banner icon="shield-checkmark-outline" title={t("auth.gateTitle")} body={t("auth.gateBody")} />
        </View>
      ) : null}
      <View className="gap-3">
        <TextField
          label={t("auth.identifier")}
          icon="person"
          value={form.identifier}
          onChangeText={(identifier) => setForm((f) => ({ ...f, identifier }))}
          onBlur={() => setTouched((x) => ({ ...x, identifier: true }))}
          error={fieldError("identifier")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="username"
          textContentType="username"
          testID="login-email"
        />
        <TextField
          label={t("auth.password")}
          icon="lock-closed"
          value={form.password}
          onChangeText={(password) => setForm((f) => ({ ...f, password }))}
          onBlur={() => setTouched((x) => ({ ...x, password: true }))}
          error={fieldError("password")}
          secureToggle
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={() => void submit()}
          testID="login-password"
        />
      </View>
      <View className="mt-1 flex-row items-center justify-end">
        <Pressable
          accessibilityRole="link"
          onPress={async () => {
            if (!form.identifier.trim()) {
              toast(t("auth.forgotNeedsEmail"), "info");
              return;
            }
            await backend.requestPasswordReset(form.identifier);
            toast(t("auth.forgotSent"), "info");
          }}
          className="min-h-[48px] justify-center"
        >
          <Text variant="captionStrong" tone="primary">
            {t("auth.forgot")}
          </Text>
        </Pressable>
      </View>
      {formError ? (
        <View className="mb-3">
          <Banner tone="lost" icon="alert-circle-outline" body={formError} />
        </View>
      ) : null}
      <Button label={t("auth.login")} onPress={() => void submit()} loading={loading} testID="login-submit" />

      <OrDivider label={t("auth.orContinue")} />
      <SocialButtons next={next} />

      <View className="mt-5 flex-row items-center justify-center gap-1">
        <Text variant="body" tone="muted">
          {t("auth.noAccount")}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push({ pathname: "/auth/register", params: { next } })}
          className="min-h-[48px] justify-center px-1"
          testID="go-register"
        >
          <Text variant="bodyStrong" tone="primary">
            {t("auth.register")}
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setForm({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD })}
        className="mt-2 rounded-2xl bg-surface-alt p-3 active:opacity-80"
        testID="fill-demo"
      >
        <Text variant="caption" className="text-center">
          {t("auth.demoAccount", { email: DEMO_EMAIL, password: DEMO_PASSWORD })}
        </Text>
      </Pressable>
    </AuthLayout>
  );
}
