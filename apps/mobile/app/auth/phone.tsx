import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { normalizeColombianMobile } from "@/domain/validation";
import { safeNext } from "@/hooks/useAuthGate";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { useBackend, useCurrentUser } from "@/store/backend";

/** Paso "agrega y verifica tu número" para cuentas sin teléfono (login social) o al cambiarlo. */
export default function AddPhoneScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const { t } = useI18n();
  const backend = useBackend();
  const user = useCurrentUser();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next } }} />;

  const send = async () => {
    if (!normalizeColombianMobile(phone)) {
      setError(t("errors.invalid_phone"));
      return;
    }
    setLoading(true);
    try {
      await backend.startPhoneVerification(phone);
      router.replace({ pathname: "/auth/verify", params: { next } });
    } catch (e) {
      const code = e instanceof BackendError ? e.code : "network";
      setError(code === "phone_taken" || code === "invalid_phone" ? t(`errors.${code}`) : t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t("auth.addPhoneTitle")} subtitle={t("auth.addPhoneSubtitle")} showBack testID="phone-screen">
      <TextField
        label={t("auth.phone")}
        icon="call"
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          setError(undefined);
        }}
        error={error}
        hint={t("auth.phoneHint")}
        keyboardType="phone-pad"
        autoComplete="tel"
        maxLength={16}
        onSubmitEditing={() => void send()}
        testID="phone-input"
      />
      <View className="mt-5">
        <Button label={t("auth.sendCode")} onPress={() => void send()} loading={loading} testID="phone-submit" />
      </View>
    </AuthLayout>
  );
}
