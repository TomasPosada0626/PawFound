import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { AuthLayout, OrDivider } from "@/components/AuthLayout";
import { SocialButtons } from "@/components/SocialButtons";
import { Button } from "@/components/ui/Button";
import { Banner, Checkbox } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { LEGAL_URLS } from "@/config";
import { validateRegister, type RegisterForm } from "@/domain/validation";
import { safeNext } from "@/hooks/useAuthGate";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { useBackend } from "@/store/backend";

type Field = keyof RegisterForm;

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const { t } = useI18n();
  const backend = useBackend();

  const [form, setForm] = useState<RegisterForm>({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
    acceptTerms: false,
    confirmAge: false,
  });
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<{ field?: Field; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const errors = validateRegister(form);
  const error = (key: Field) => {
    if (serverError?.field === key) return serverError.message;
    return (touched[key] || submitted) && errors[key] ? t(`errors.${errors[key]}` as "errors.required") : undefined;
  };
  const set = <K extends Field>(key: K, value: RegisterForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (serverError?.field === key) setServerError(null);
  };
  const blur = (key: Field) => () => setTouched((x) => ({ ...x, [key]: true }));

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setLoading(true);
    try {
      await backend.register(form);
      router.replace({ pathname: "/auth/verify", params: { next } });
    } catch (e) {
      const code = e instanceof BackendError ? e.code : "network";
      if (code === "email_taken") setServerError({ field: "email", message: t("errors.email_taken") });
      else if (code === "phone_taken" || code === "invalid_phone")
        setServerError({ field: "phone", message: t(`errors.${code}`) });
      else setServerError({ message: t("errors.network") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t("auth.registerTitle")} subtitle={t("auth.registerSubtitle")} showBack testID="register-screen">
      <View className="gap-3">
        <TextField
          label={t("auth.fullName")}
          icon="person"
          value={form.name}
          onChangeText={(v) => set("name", v)}
          onBlur={blur("name")}
          error={error("name")}
          autoComplete="name"
          textContentType="name"
          maxLength={60}
          testID="register-name"
        />
        <TextField
          label={t("auth.email")}
          icon="mail"
          value={form.email}
          onChangeText={(v) => set("email", v)}
          onBlur={blur("email")}
          error={error("email")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          testID="register-email"
        />
        <TextField
          label={t("auth.phone")}
          icon="call"
          value={form.phone}
          onChangeText={(v) => set("phone", v)}
          onBlur={blur("phone")}
          error={error("phone")}
          hint={t("auth.phoneHint")}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={16}
          testID="register-phone"
        />
        <TextField
          label={t("auth.password")}
          icon="lock-closed"
          value={form.password}
          onChangeText={(v) => set("password", v)}
          onBlur={blur("password")}
          error={error("password")}
          hint={t("auth.passwordRules")}
          secureToggle
          autoComplete="new-password"
          textContentType="newPassword"
          testID="register-password"
        />
        <TextField
          label={t("auth.confirmPassword")}
          icon="lock-closed"
          value={form.confirm}
          onChangeText={(v) => set("confirm", v)}
          onBlur={blur("confirm")}
          error={error("confirm")}
          secureToggle
          autoComplete="new-password"
          testID="register-confirm"
        />
      </View>

      {/* Consentimientos: nunca preseleccionados (docs/legal/consentimientos.md) */}
      <View className="mt-3">
        <Checkbox
          checked={form.acceptTerms}
          onChange={(v) => set("acceptTerms", v)}
          label={`${t("auth.acceptTermsPrefix")} ${t("auth.terms")} ${t("auth.and")} ${t("auth.privacy")}`}
          testID="accept-terms"
        >
          <Text variant="caption" tone="body">
            {`${t("auth.acceptTermsPrefix")} `}
            <Text
              variant="captionStrong"
              tone="primary"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(LEGAL_URLS.terms)}
            >
              {t("auth.terms")}
            </Text>
            {` ${t("auth.and")} `}
            <Text
              variant="captionStrong"
              tone="primary"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}
            >
              {t("auth.privacy")}
            </Text>
          </Text>
        </Checkbox>
        <Checkbox
          checked={form.confirmAge}
          onChange={(v) => set("confirmAge", v)}
          label={t("auth.confirmAge")}
          testID="confirm-age"
        />
      </View>

      {serverError && !serverError.field ? (
        <View className="my-2">
          <Banner tone="lost" icon="cloud-offline-outline" body={serverError.message} />
        </View>
      ) : null}

      <View className="mt-3">
        <Button
          label={t("auth.create")}
          onPress={() => void submit()}
          loading={loading}
          disabled={!form.acceptTerms || !form.confirmAge}
          testID="register-submit"
        />
      </View>

      <OrDivider label={t("auth.orRegister")} />
      <SocialButtons next={next} />

      <View className="mt-5 flex-row items-center justify-center gap-1">
        <Text variant="body" tone="muted">
          {t("auth.haveAccount")}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/auth/login", params: { next } }))}
          className="min-h-[48px] justify-center px-1"
        >
          <Text variant="bodyStrong" tone="primary">
            {t("auth.signIn")}
          </Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}
