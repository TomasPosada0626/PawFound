import { Redirect } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Screen } from "@/components/layout";
import { PawFamilyHeader, ShelterTag } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { normalizeNit } from "@/domain/shelter";
import { errorMessage } from "@/features/errorMessages";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { useBackend, useCurrentUser } from "@/store/backend";

/** Un refugio pide la verificación adicional con su NIT; moderación la revisa. */
export default function ShelterScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const user = useCurrentUser();
  const toast = useToast();
  const [name, setName] = useState(user?.shelterName ?? "");
  const [nit, setNit] = useState("");
  const [errors, setErrors] = useState<{ name?: string; nit?: string }>({});
  const [sending, setSending] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/pawfamily/refugio" } }} />;
  const status = user.shelterStatus;

  const send = async () => {
    const next = {
      name: name.trim() ? undefined : t("errors.required"),
      nit: normalizeNit(nit) ? undefined : t("pawfamily.shelterInvalidNit"),
    };
    setErrors(next);
    if (next.name || next.nit) return;
    setSending(true);
    try {
      await backend.requestShelterVerification(name, nit);
      toast(t("pawfamily.shelterSent"));
    } catch (err) {
      toast(errorMessage(err instanceof BackendError ? err.code : "unknown", t), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen header={<PawFamilyHeader back title={t("pawfamily.shelterTitle")} />} testID="shelter-screen">
      <Text variant="body" tone="muted">
        {t("pawfamily.shelterIntro")}
      </Text>
      {status ? (
        <View className="mt-4 gap-2" testID={`shelter-${status}`}>
          {status === "verified" ? <ShelterTag /> : null}
          <Banner
            icon={
              status === "verified" ? "shield-checkmark-outline" : status === "pending" ? "time-outline" : "alert-circle-outline"
            }
            tone={status === "rejected" ? "warning" : "primary"}
            body={t(`pawfamily.shelter_${status}`, { name: user.shelterName ?? "" })}
          />
        </View>
      ) : null}
      {status === "verified" || status === "pending" ? null : (
        <View className="mt-4 gap-3">
          <TextField
            label={t("pawfamily.shelterName")}
            value={name}
            onChangeText={setName}
            maxLength={80}
            error={errors.name}
            testID="shelter-name"
          />
          <TextField
            label={t("pawfamily.shelterNit")}
            value={nit}
            onChangeText={setNit}
            keyboardType="numbers-and-punctuation"
            hint={t("pawfamily.shelterNitHint")}
            error={errors.nit}
            testID="shelter-nit"
          />
          <Button
            label={t("pawfamily.shelterSend")}
            icon="shield-checkmark"
            loading={sending}
            onPress={() => void send()}
            testID="shelter-send"
          />
        </View>
      )}
    </Screen>
  );
}
