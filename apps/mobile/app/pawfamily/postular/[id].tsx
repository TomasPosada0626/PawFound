import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Screen } from "@/components/layout";
import { PawFamilyHeader } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner, Chip } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { APPLICATION_REASON_MAX, applicationProblem, type ApplicationInput } from "@/domain/adoption";
import { errorMessage } from "@/features/errorMessages";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { adoptionView } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

/** El informe corto para adoptar: solo lo necesario para que la familia decida. */
export default function ApplyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const adoption = id ? adoptionView(state, id) : undefined;
  const [form, setForm] = useState({
    fullName: user?.name ?? "",
    household: "",
    neighborhood: user?.neighborhood ?? "",
    city: user?.city ?? "",
    hadPets: false,
    petsCount: "",
    reason: "",
  });
  const [problem, setProblem] = useState<keyof ApplicationInput | null>(null);
  const [sending, setSending] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: `/pawfamily/postular/${id ?? ""}` } }} />;
  if (!adoption) return <Redirect href="/pawfamily" />;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  // "esta perrita", "este gatico", "esta mascota": así se nombra a quien se quiere adoptar.
  const gender = adoption.species === "other" || adoption.sex === "female" ? "f" : "m";
  const noun = adoption.species === "other" ? t("pawfamily.this_other") : t(`pawfamily.this_${adoption.species}_${gender}`);
  const error = (field: keyof ApplicationInput) => (problem === field ? t(`pawfamily.invalid_${field}`) : undefined);

  const send = async () => {
    const input: ApplicationInput = {
      fullName: form.fullName,
      household: Number(form.household),
      neighborhood: form.neighborhood,
      city: form.city,
      hadPets: form.hadPets,
      petsCount: form.hadPets ? Number(form.petsCount || 0) : 0,
      reason: form.reason,
    };
    const found = applicationProblem(input);
    setProblem(found);
    if (found) return;
    setSending(true);
    try {
      await backend.acceptAdoptionTerms();
      await backend.applyToAdoption(adoption.id, input);
      toast(t("pawfamily.applied", { name: adoption.name }));
      router.replace(`/pawfamily/${adoption.id}`);
    } catch (err) {
      const code = err instanceof BackendError ? err.code : "unknown";
      toast(code === "already_applied" ? t("pawfamily.alreadyApplied") : errorMessage(code, t), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      header={<PawFamilyHeader back title={t("pawfamily.applyTitle", { name: adoption.name })} />}
      testID="adoption-apply-form"
    >
      <View className="gap-3">
        <TextField
          label={t("pawfamily.fullName")}
          value={form.fullName}
          onChangeText={(v) => set("fullName", v)}
          error={error("fullName")}
          testID="apply-name"
        />
        <TextField
          label={t("pawfamily.householdLabel")}
          value={form.household}
          onChangeText={(v) => set("household", v.replace(/\D/g, ""))}
          keyboardType="number-pad"
          error={error("household")}
          testID="apply-household"
        />
        <TextField
          label={t("pawfamily.neighborhood")}
          value={form.neighborhood}
          onChangeText={(v) => set("neighborhood", v)}
          error={error("neighborhood")}
          testID="apply-neighborhood"
        />
        <TextField
          label={t("pawfamily.city")}
          value={form.city}
          onChangeText={(v) => set("city", v)}
          error={error("city")}
          testID="apply-city"
        />
        <Text variant="captionStrong">{t("pawfamily.hadPetsQuestion")}</Text>
        <View className="flex-row gap-2">
          <Chip label={t("pawfamily.yes")} selected={form.hadPets} onPress={() => set("hadPets", true)} testID="apply-had-pets" />
          <Chip label={t("pawfamily.no")} selected={!form.hadPets} onPress={() => set("hadPets", false)} testID="apply-no-pets" />
        </View>
        {form.hadPets ? (
          <TextField
            label={t("pawfamily.petsCount")}
            value={form.petsCount}
            onChangeText={(v) => set("petsCount", v.replace(/\D/g, ""))}
            keyboardType="number-pad"
            error={error("petsCount")}
            testID="apply-pets-count"
          />
        ) : null}
        <TextField
          label={t("pawfamily.reasonLabel", { pet: noun })}
          value={form.reason}
          onChangeText={(v) => set("reason", v)}
          multiline
          maxLength={APPLICATION_REASON_MAX}
          showCounter
          error={error("reason")}
          testID="apply-reason"
        />
        <Banner icon="lock-closed-outline" body={t("pawfamily.applyPrivacy")} />
        <Button label={t("pawfamily.applySend")} icon="send" loading={sending} onPress={() => void send()} testID="apply-send" />
      </View>
    </Screen>
  );
}
