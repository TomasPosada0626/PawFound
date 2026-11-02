import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { Screen } from "@/components/layout";
import { AdoptionCard, PawFamilyHeader, PawFamilyMark, PawFamilyWordmark } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner, Checkbox, Chip, EmptyState, ListRow } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { ADOPTION_RADII, DEFAULT_ADOPTION_FILTERS, type AdoptionFilters } from "@/domain/adoption";
import { distanceMeters } from "@/domain/geo";
import { useAuthGate } from "@/hooks/useAuthGate";
import { cityFromPoint } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { adoptionView } from "@/services/selectors";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useUserLocation } from "@/store/location";

/**
 * PawFamily: mascotas en adopción cerca de ti. Al entrar por primera vez hay que aceptar las
 * políticas de adopción responsable y gratuita.
 */
export default function PawFamilyScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const requireAccount = useAuthGate();
  const { location } = useUserLocation();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<AdoptionFilters>(DEFAULT_ADOPTION_FILTERS);
  const [wholeCity, setWholeCity] = useState(false);
  const [city, setCity] = useState<string | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const profileCity = user?.city;

  useEffect(() => {
    readJSON<boolean>(STORAGE_KEYS.pawfamilyTerms)
      .then((value) => setAccepted(Boolean(value)))
      .catch(() => setAccepted(false));
  }, []);

  useEffect(() => {
    let live = true;
    void cityFromPoint(location).then((found) => {
      if (live) setCity(found ?? (profileCity || null));
    });
    return () => {
      live = false;
    };
  }, [location, profileCity]);

  const query = useMemo(() => ({ ...filters, city: wholeCity && city ? city : undefined }), [filters, wholeCity, city]);
  useEffect(() => {
    if (!accepted) return;
    let live = true;
    backend
      .loadAdoptions(location, query)
      .then((list) => {
        if (live) setIds(list);
      })
      .catch(() => {
        if (live) setIds([]);
      });
    return () => {
      live = false;
    };
  }, [accepted, backend, location, query, state.adoptionVersion]);

  if (accepted === null) return <Screen header={<PawFamilyHeader />}>{null}</Screen>;
  if (!accepted) {
    return (
      <Terms
        onAccept={async () => {
          await writeJSON(STORAGE_KEYS.pawfamilyTerms, true);
          if (user) void backend.acceptAdoptionTerms().catch(() => {});
          setAccepted(true);
        }}
      />
    );
  }

  const set = <K extends keyof AdoptionFilters>(key: K, value: AdoptionFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? undefined : value }));
  const list = (ids ?? []).map((id) => adoptionView(state, id)).filter((a) => a !== undefined);

  return (
    <Screen header={<PawFamilyHeader />} testID="pawfamily">
      <Banner icon="heart-outline" body={t("pawfamily.freeBanner")} />
      <View className="mt-3 flex-row flex-wrap gap-2">
        <Button
          compact
          icon="add"
          label={t("pawfamily.publish")}
          onPress={() => {
            if (requireAccount("/pawfamily/publicar")) router.push("/pawfamily/publicar");
          }}
          testID="pawfamily-publish"
        />
        {user ? (
          <>
            <Button compact variant="outline" label={t("pawfamily.mine")} onPress={() => router.push("/pawfamily/mias")} />
            <Button
              compact
              variant="outline"
              label={t("pawfamily.myRequests")}
              onPress={() => router.push("/pawfamily/solicitudes")}
            />
          </>
        ) : null}
      </View>

      <View className="mt-3">
        <ListRow
          icon="shield-checkmark-outline"
          tone="lost"
          title={t("pawfamily.shelterQuestion")}
          description={t("pawfamily.shelterQuestionBody")}
          onPress={() => {
            if (requireAccount("/pawfamily/refugio")) router.push("/pawfamily/refugio");
          }}
          testID="open-shelter"
        />
      </View>

      <Text variant="captionStrong" className="mb-2 mt-4">
        {t("pawfamily.distance")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {ADOPTION_RADII.map((km) => (
          <Chip
            key={km}
            label={t("pawfamily.km", { count: km })}
            selected={!wholeCity && filters.radiusKm === km}
            onPress={() => {
              setWholeCity(false);
              setFilters((f) => ({ ...f, radiusKm: km }));
            }}
            testID={`radius-${km}`}
          />
        ))}
        {city ? (
          <Chip
            label={t("pawfamily.wholeCity", { city })}
            selected={wholeCity}
            onPress={() => setWholeCity((v) => !v)}
            testID="whole-city"
          />
        ) : null}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} className="mt-3">
        <Chip
          label={t("species.dog")}
          selected={filters.species === "dog"}
          onPress={() => set("species", "dog")}
          testID="filter-dog"
        />
        <Chip
          label={t("species.cat")}
          selected={filters.species === "cat"}
          onPress={() => set("species", "cat")}
          testID="filter-cat"
        />
        <Chip
          label={t("pawfamily.female")}
          selected={filters.sex === "female"}
          onPress={() => set("sex", "female")}
          testID="filter-female"
        />
        <Chip
          label={t("pawfamily.male")}
          selected={filters.sex === "male"}
          onPress={() => set("sex", "male")}
          testID="filter-male"
        />
        {(["small", "medium", "large"] as const).map((size) => (
          <Chip
            key={size}
            label={t(`size.${size}`)}
            selected={filters.size === size}
            onPress={() => set("size", size)}
            testID={`filter-${size}`}
          />
        ))}
        {(["puppy", "young", "adult", "senior"] as const).map((age) => (
          <Chip
            key={age}
            label={t(`age.${age}`)}
            selected={filters.age === age}
            onPress={() => set("age", age)}
            testID={`filter-${age}`}
          />
        ))}
      </ScrollView>

      <View className="mt-4">
        {ids === null ? (
          <Text variant="caption">{t("pawfamily.loading")}</Text>
        ) : list.length === 0 ? (
          <EmptyState icon="paw-outline" title={t("pawfamily.empty")} body={t("pawfamily.emptyHint")} />
        ) : (
          list.map((adoption) => (
            <AdoptionCard key={adoption.id} adoption={adoption} distanceMeters={distanceMeters(location, adoption.location)} />
          ))
        )}
      </View>
    </Screen>
  );
}

/** Políticas de PawFamily: hay que aceptarlas antes de entrar. */
function Terms({ onAccept }: { onAccept: () => Promise<void> }) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const points = ["pawfamily.termsFree", "pawfamily.termsTruth", "pawfamily.termsReport", "pawfamily.termsDecision"] as const;
  return (
    <Screen header={<PawFamilyHeader />} testID="pawfamily-terms">
      <View className="items-center gap-2">
        <PawFamilyMark size={72} />
        <PawFamilyWordmark size={30} />
        <Text variant="title" className="mt-2 text-center" accessibilityRole="header">
          {t("pawfamily.termsTitle")}
        </Text>
        <Text variant="body" tone="muted" className="text-center">
          {t("pawfamily.termsIntro")}
        </Text>
      </View>
      <View className="mt-5 gap-3">
        {points.map((key) => (
          <View key={key} className="flex-row gap-3">
            <Text variant="bodyStrong">•</Text>
            <Text variant="body" className="flex-1">
              {t(key)}
            </Text>
          </View>
        ))}
      </View>
      <View className="mt-5">
        <Checkbox checked={checked} onChange={setChecked} label={t("pawfamily.termsAccept")} testID="pawfamily-terms-check" />
      </View>
      <View className="mt-4">
        <Button
          label={t("pawfamily.termsContinue")}
          disabled={!checked}
          loading={saving}
          onPress={() => {
            setSaving(true);
            void onAccept().finally(() => setSaving(false));
          }}
          testID="pawfamily-terms-accept"
        />
      </View>
    </Screen>
  );
}
