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
import { PASSWORD_MIN_LENGTH, validateRegister, type RegisterForm } from "@/domain/validation";
import { safeNext } from "@/hooks/useAuthGate";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "@/components/ui/Icon";
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
    username: "",
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
      else if (code === "username_taken" || code === "invalid_username")
        setServerError({ field: "username", message: t(`errors.${code}`) });
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
          label={t("auth.username")}
          icon="at"
          value={form.username}
          onChangeText={(v) => set("username", v.replace(/\s/g, ""))}
          onBlur={blur("username")}
          error={error("username")}
          hint={t("auth.usernameHint")}
          autoCapitalize="none"
          autoComplete="username-new"
          textContentType="username"
          maxLength={21}
          testID="register-username"
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
        <PasswordChecklist password={form.password} />
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

const RULES = [
  { key: "auth.ruleLength", test: (p: string) => p.length >= PASSWORD_MIN_LENGTH },
  { key: "auth.ruleUpper", test: (p: string) => /[A-ZÁÉÍÓÚÑ]/.test(p) },
  { key: "auth.ruleLower", test: (p: string) => /[a-záéíóúñü]/.test(p) },
  { key: "auth.ruleNumber", test: (p: string) => /\d/.test(p) },
] as const;

/** Requisitos de la contraseña a la vista, marcados a medida que se cumplen. */
function PasswordChecklist({ password }: { password: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View className="-mt-1 flex-row flex-wrap gap-x-4 gap-y-1 px-1" testID="password-checklist">
      {RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <View
            key={rule.key}
            className="flex-row items-center gap-1.5"
            accessible
            accessibilityLabel={`${t(rule.key)}: ${ok ? t("auth.ruleMet") : t("auth.ruleMissing")}`}
          >
            <Icon name={ok ? "checkmark-circle" : "ellipse-outline"} size={16} color={ok ? colors.primaryStrong : colors.muted} />
            <Text variant="caption" tone={ok ? "primary" : "muted"}>
              {t(rule.key)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
