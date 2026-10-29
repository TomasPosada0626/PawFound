import * as Haptics from "expo-haptics";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { AppHeader, BackButton, Screen, ThemeButton } from "@/components/layout";
import { PetMap } from "@/components/map/PetMap";
import { petDisplayName } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { regionForRadius } from "@/domain/geo";
import type { LatLng } from "@/domain/types";
import { WHEN_KEYS, WHEN_OFFSETS_MIN, type WhenKey } from "@/features/reportDraft";
import { usePlacePicker, zoneFromPoint } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

/** "La vi": avistamiento rápido que mueve el último punto conocido y reinicia el círculo. */
export default function SightingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const pickPlace = usePlacePicker();
  const pet = state.pets.find((p) => p.id === id);

  const [when, setWhen] = useState<WhenKey>("now");
  const [point, setPoint] = useState<LatLng | null>(null);
  const [zone, setZone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const region = useMemo(
    () => regionForRadius(point ?? pet?.location ?? { latitude: 6.2447, longitude: -75.5916 }, 800),
    [point, pet],
  );

  if (!user || !user.verified) return <Redirect href={{ pathname: "/auth/login", params: { next: `/pet/${id}/sighting` } }} />;
  if (!pet) return <Redirect href="/" />;

  const place = async (p: LatLng, z?: string | null) => {
    setPoint(p);
    setError(undefined);
    const resolved = z ?? (await zoneFromPoint(p));
    if (resolved && !zone.trim()) setZone(resolved);
  };

  const submit = async () => {
    if (!point) {
      setError(t("errors.location_required"));
      return;
    }
    setSending(true);
    try {
      await backend.addSighting(pet.id, {
        at: new Date(Date.now() - WHEN_OFFSETS_MIN[when] * 60_000).toISOString(),
        location: point,
        zone: zone.trim() || pet.zone,
        note,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(t("sighting.success"));
      router.back();
    } catch {
      toast(t("errors.unknown"), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      testID="sighting-screen"
      header={<AppHeader left={<BackButton fallback={`/pet/${pet.id}`} />} right={<ThemeButton mode="dark" />} />}
    >
      <Text variant="title" className="text-center" accessibilityRole="header">
        {t("sighting.title")}
      </Text>
      <Text variant="body" tone="muted" className="mb-5 text-center">
        {t("sighting.subtitle", { name: petDisplayName(pet, t) })}
      </Text>

      <Text variant="subheading" className="mb-2">
        {t("sighting.when")}
      </Text>
      <View className="mb-5 flex-row flex-wrap gap-2">
        {WHEN_KEYS.slice(0, 6).map((w) => (
          <Chip key={w} label={t(`whenOptions.${w}`)} selected={when === w} onPress={() => setWhen(w)} />
        ))}
      </View>

      <Text variant="subheading" className="mb-2">
        {t("sighting.where")}
      </Text>
      <View className={`overflow-hidden rounded-3xl border-[1.5px] ${error ? "border-danger" : "border-border"}`}>
        <PetMap
          height={240}
          region={region}
          marker={point ? { coordinate: point, kind: "lost" } : undefined}
          circles={[{ center: pet.location, radius: 150, kind: "lost", variant: "layer" }]}
          onMapPress={(p) => void place(p)}
          testID="sighting-map"
        />
      </View>
      <Text variant="caption" tone={error ? "danger" : "muted"} className="ml-1 mt-1" accessibilityLiveRegion="polite">
        {error ?? t("sighting.whereHint")}
      </Text>
      <View className="mt-3">
        <Button
          label={t("sighting.useMyLocation")}
          icon="locate"
          variant="outline"
          compact
          onPress={async () => {
            const result = await pickPlace();
            if (result) await place(result.point, result.zone);
          }}
          testID="sighting-locate"
        />
      </View>
      <TextField
        className="mt-3"
        label={t("report.addressPlaceholder")}
        icon="location-outline"
        value={zone}
        onChangeText={setZone}
        maxLength={80}
      />
      <TextField
        className="mt-3"
        label={t("sighting.note")}
        placeholderText={t("sighting.notePlaceholder")}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={280}
        showCounter
      />
      <View className="mt-6">
        <Button
          label={t("sighting.submit")}
          icon="eye"
          onPress={() => void submit()}
          loading={sending}
          testID="sighting-submit"
        />
      </View>
    </Screen>
  );
}
