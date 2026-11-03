import { Redirect, router } from "expo-router";
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
import type { TKey } from "@/i18n/core";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError, type ErrorCode } from "@/services/backendTypes";
import { STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useCurrentUser } from "@/store/backend";

/** Por qué el RUES no confirmó el refugio, en el campo que hay que corregir. */
const REFUSALS: Partial<Record<ErrorCode, { field: "name" | "nit"; key: TKey }>> = {
  nit_taken: { field: "nit", key: "pawfamily.shelterNitTaken" },
  nit_inactive: { field: "nit", key: "pawfamily.shelterNitInactive" },
  nit_not_found: { field: "nit", key: "pawfamily.shelterNitNotFound" },
  nit_not_nonprofit: { field: "nit", key: "pawfamily.shelterNotNonprofit" },
  nit_dv_mismatch: { field: "nit", key: "pawfamily.shelterDvMismatch" },
  shelter_name_mismatch: { field: "name", key: "pawfamily.shelterNameMismatch" },
};

/**
 * Entrar como refugio: nombre y NIT. La API revisa el NIT en el RUES y decide sola: una fundación,
 * asociación o corporación activa con ese nombre queda verificada al instante y pasa al panel del
 * refugio; si no, dice qué corregir. Solo si el RUES no responde queda esperando y se avisa después.
 */
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

  const enterAsShelter = async () => {
    await writeJSON(STORAGE_KEYS.pawfamilyRole, "shelter");
    router.replace("/pawfamily");
  };

  const send = async () => {
    const next = {
      name: name.trim() ? undefined : t("errors.required"),
      nit: normalizeNit(nit) ? undefined : t("pawfamily.shelterInvalidNit"),
    };
    setErrors(next);
    if (next.name || next.nit) return;
    setSending(true);
    try {
      const result = await backend.verifyShelter(name, nit);
      if (result.status === "verified") {
        toast(t("pawfamily.shelterVerifiedToast", { name: name.trim() }));
        await enterAsShelter();
      } else {
        toast(t("pawfamily.shelterPendingToast", { name: name.trim() }), "info");
      }
    } catch (err) {
      const code = err instanceof BackendError ? err.code : "unknown";
      const refusal = REFUSALS[code];
      if (refusal) setErrors({ [refusal.field]: t(refusal.key) });
      else toast(errorMessage(code, t), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen header={<PawFamilyHeader back title={t("pawfamily.shelterTitle")} />} testID="shelter-screen">
      <Text variant="body" tone="muted">
        {t("pawfamily.shelterIntro")}
      </Text>
      {status === "verified" ? (
        <View className="mt-4 gap-3" testID="shelter-verified">
          <ShelterTag />
          <Banner icon="shield-checkmark-outline" body={t("pawfamily.shelter_verified", { name: user.shelterName ?? "" })} />
          <Button label={t("pawfamily.shelterEnter")} onPress={() => void enterAsShelter()} testID="shelter-enter" />
        </View>
      ) : status === "rejected" ? (
        <View className="mt-4" testID="shelter-rejected">
          <Banner
            icon="alert-circle-outline"
            tone="warning"
            body={t("pawfamily.shelter_rejected", { name: user.shelterName ?? "" })}
          />
        </View>
      ) : (
        <View className="mt-4 gap-3">
          {status === "pending" ? (
            <View testID="shelter-pending">
              <Banner icon="time-outline" body={t("pawfamily.shelter_pending", { name: user.shelterName ?? "" })} />
            </View>
          ) : null}
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
          <Text variant="caption" tone="muted" className="text-center">
            {t("pawfamily.shelterSource")}
          </Text>
        </View>
      )}
    </Screen>
  );
}
