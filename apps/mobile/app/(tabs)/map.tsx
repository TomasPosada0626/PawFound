import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader } from "@/components/layout";
import { PetMap } from "@/components/map/PetMap";
import { PetCard, petDisplayName } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, Chip, ToggleRow } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { OptionList, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { distanceMeters, formatDistance, regionForRadius, type Region } from "@/domain/geo";
import { currentRadius } from "@/domain/lifeCircle";
import { clusterPets, type ClusterItem } from "@/domain/rules";
import type { PetCase } from "@/domain/types";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_FILTERS, filterPets, type KindFilter, type PetFilters } from "@/services/selectors";
import { useBackendState } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

const DEFAULT_RADIUS = 2500;

export default function MapScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const state = useBackendState();
  const now = useNow();
  const { location, hasRealLocation, status, request } = useUserLocation();
  const { locationConsent, setLocationConsent } = useDevicePrefs();

  const [filters, setFilters] = useState<PetFilters>(DEFAULT_FILTERS);
  const [target, setTarget] = useState<Region>(() => regionForRadius(location, DEFAULT_RADIUS));
  const [visible, setVisible] = useState<Region>(target);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [showCircles, setShowCircles] = useState(false);

  const results = useMemo(() => filterPets(state.pets, location, now, filters), [state.pets, location, now, filters]);
  const clusters = useMemo(
    () =>
      clusterPets(
        results.map((r) => r.pet),
        visible,
      ),
    [results, visible],
  );
  // Capa opcional: el círculo de vida vive en el detalle (docs/flujos/mapa-e-inicio.md); aquí solo si se activa.
  const lifeCircles = useMemo(
    () =>
      showCircles
        ? results
            .filter((r) => r.pet.kind === "lost")
            .map((r) => ({
              id: r.pet.id,
              center: r.pet.location,
              radius: currentRadius(r.pet, now),
              kind: r.pet.kind,
              variant: "layer" as const,
            }))
        : [],
    [showCircles, results, now],
  );

  const locateMe = async () => {
    if (locationConsent !== "granted") {
      setConsentOpen(true);
      return;
    }
    const point = await request();
    setTarget(regionForRadius(point ?? location, DEFAULT_RADIUS));
  };

  const pinLabel = (pet: PetCase) =>
    t("map.pinLabel", {
      name: petDisplayName(pet, t),
      species: t(`speciesLower.${pet.species}`),
      status: pet.kind === "lost" ? t("status.lost") : t("status.found"),
      distance: formatDistance(distanceMeters(location, pet.location), locale),
    });

  const zoomInto = (cluster: ClusterItem) =>
    setTarget({
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      latitudeDelta: visible.latitudeDelta / 3,
      longitudeDelta: visible.longitudeDelta / 3,
    });

  const setKind = (kind: KindFilter) => setFilters((f) => ({ ...f, kind }));
  const advancedActive = filters.species !== "any" || filters.maxDistance !== null || filters.withinHours !== null;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.bg }} testID="map-screen">
      <AppHeader />
      <View className="gap-3 px-4 pb-3">
        <View className="flex-row items-center gap-2">
          <View className="min-h-[52px] flex-1 flex-row items-center gap-2 rounded-2xl border border-border/60 bg-surface px-4 shadow-sm shadow-black/10">
            <Icon name="search" size={20} color={colors.muted} />
            <TextInput
              accessibilityLabel={t("map.searchLabel")}
              placeholder={t("map.searchPlaceholder")}
              placeholderTextColor={colors.muted}
              value={filters.query}
              onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
              returnKeyType="search"
              className="flex-1 font-regular text-[15px] text-ink"
              testID="map-search"
            />
            {filters.query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("map.reset")}
                onPress={() => setFilters((f) => ({ ...f, query: "" }))}
                className="h-10 w-10 items-center justify-center"
              >
                <Icon name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("map.advancedFilters")}
            accessibilityState={{ selected: advancedActive }}
            onPress={() => setFiltersOpen(true)}
            className="h-[52px] w-[52px] items-center justify-center rounded-2xl border border-border/60 bg-surface shadow-sm shadow-black/10 active:opacity-80"
          >
            <Icon name="options-outline" size={22} color={colors.primaryStrong} />
            {advancedActive ? <View className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-lost" /> : null}
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip
            label={t("map.filterAll")}
            icon="paw"
            selected={filters.kind === "all"}
            onPress={() => setKind("all")}
            testID="filter-all"
          />
          <Chip
            label={t("map.filterLost")}
            dotColor={statusColor.lost}
            selected={filters.kind === "lost"}
            onPress={() => setKind("lost")}
            testID="filter-lost"
          />
          <Chip
            label={t("map.filterFound")}
            dotColor={statusColor.found}
            selected={filters.kind === "found"}
            onPress={() => setKind("found")}
            testID="filter-found"
          />
          <Chip label={t("map.filters")} icon="funnel-outline" selected={advancedActive} onPress={() => setFiltersOpen(true)} />
        </ScrollView>
      </View>

      <View className="flex-1">
        <PetMap
          region={target}
          onRegionChange={setVisible}
          clusters={clusters}
          circles={lifeCircles}
          onPetPress={(pet) => router.push(`/pet/${pet.id}`)}
          onClusterPress={zoomInto}
          pinLabel={pinLabel}
          clusterLabel={(c) => t("map.clusterLabel", { count: c.pets.length })}
          showsUserLocation={hasRealLocation}
          satellite={satellite}
          testID="pet-map"
        />

        <View className="absolute right-4 top-3 gap-2.5">
          <FloatingButton
            icon="locate"
            label={t("map.recenter")}
            onPress={() => setTarget(regionForRadius(location, DEFAULT_RADIUS))}
            testID="recenter"
          />
          <FloatingButton
            icon="layers-outline"
            label={t("map.layers")}
            caption={t("map.layers")}
            onPress={() => setLayersOpen(true)}
            testID="layers"
          />
          <FloatingButton
            icon="navigate-outline"
            label={t("map.myLocation")}
            caption={t("map.myLocation")}
            onPress={() => void locateMe()}
            testID="locate-me"
          />
        </View>

        {/* Hoja inferior "Mascotas cerca de ti" */}
        <View
          className="absolute bottom-0 left-0 right-0 rounded-t-[28px] bg-surface pt-2 shadow-lg shadow-black/15"
          style={{ paddingBottom: 104 }}
        >
          <View className="mb-2 h-1.5 w-12 self-center rounded-full bg-border" />
          <View className="flex-row items-center justify-between px-4">
            <View>
              <Text variant="heading" accessibilityRole="header">
                {t("map.nearby")}
              </Text>
              <Text variant="caption" accessibilityLiveRegion="polite">
                {t("map.results", { count: results.length })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/list?filter=nearby")}
              className="min-h-[44px] flex-row items-center gap-1 active:opacity-70"
            >
              <Text variant="captionStrong" tone="primary">
                {t("map.seeList")}
              </Text>
              <Icon name="chevron-forward" size={16} color={colors.primaryStrong} />
            </Pressable>
          </View>
          {status === "denied" ? (
            <View className="px-4 pt-2">
              <Banner tone="warning" icon="location-outline" body={t("map.locationDenied")} />
            </View>
          ) : null}
          {results.length === 0 ? (
            <View className="items-center gap-3 px-6 py-6" testID="map-empty">
              <Text variant="subheading" className="text-center">
                {t("map.empty")}
              </Text>
              <Text variant="caption" className="text-center">
                {t("map.emptyHint")}
              </Text>
              <Button
                label={t("map.expandArea")}
                variant="outline"
                compact
                icon="expand"
                onPress={() => {
                  setFilters(DEFAULT_FILTERS);
                  setTarget(regionForRadius(location, DEFAULT_RADIUS * 3));
                }}
              />
            </View>
          ) : (
            <FlatList
              horizontal
              data={results}
              keyExtractor={(item) => item.pet.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 12 }}
              renderItem={({ item }) => <PetCard pet={item.pet} distance={item.distance} now={now} width={164} />}
            />
          )}
        </View>
      </View>

      <AdvancedFilters
        visible={filtersOpen}
        filters={filters}
        resultCount={results.length}
        onChange={setFilters}
        onClose={() => setFiltersOpen(false)}
      />

      <Sheet visible={layersOpen} onClose={() => setLayersOpen(false)} title={t("map.layers")}>
        <OptionList
          options={[
            { value: "standard", label: t("map.mapStandard"), icon: "map-outline" },
            { value: "satellite", label: t("map.mapSatellite"), icon: "earth-outline" },
          ]}
          value={satellite ? "satellite" : "standard"}
          onSelect={(v) => setSatellite(v === "satellite")}
        />
        <ToggleRow
          icon="radio-button-on"
          tone="lost"
          title={t("lifeCircle.layer")}
          description={t("lifeCircle.layerHint")}
          value={showCircles}
          onChange={setShowCircles}
          testID="toggle-life-circles"
        />
      </Sheet>

      {/* Consentimiento propio antes del permiso del sistema (docs/legal/consentimientos.md) */}
      <Sheet visible={consentOpen} onClose={() => setConsentOpen(false)} title={t("map.locationConsentTitle")}>
        <Text variant="body" className="mb-5">
          {t("map.locationConsentBody")}
        </Text>
        <View className="gap-3 pb-2">
          <Button
            label={t("map.allow")}
            icon="location"
            testID="consent-allow"
            onPress={async () => {
              setLocationConsent("granted");
              setConsentOpen(false);
              const point = await request();
              setTarget(regionForRadius(point ?? location, DEFAULT_RADIUS));
            }}
          />
          <Button
            label={t("map.notNow")}
            variant="ghost"
            onPress={() => {
              setLocationConsent("denied");
              setConsentOpen(false);
            }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function FloatingButton({
  icon,
  label,
  caption,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  caption?: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      className="min-h-[56px] min-w-[56px] items-center justify-center rounded-2xl bg-surface px-2 py-2 shadow-md shadow-black/15 active:opacity-80"
    >
      <Icon name={icon} size={24} color={colors.ink} />
      {caption ? (
        <Text variant="label" tone="muted" className="text-[10px]">
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

function AdvancedFilters({
  visible,
  filters,
  resultCount,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: PetFilters;
  resultCount: number;
  onChange: (f: PetFilters) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const species: { key: PetFilters["species"]; label: string }[] = [
    { key: "any", label: t("map.anySpecies") },
    { key: "dog", label: t("species.dog") },
    { key: "cat", label: t("species.cat") },
    { key: "other", label: t("species.other") },
  ];
  const distances: (number | null)[] = [null, 1000, 3000, 5000, 10000];
  const windows: { key: number | null; label: string }[] = [
    { key: null, label: t("map.anyTime") },
    { key: 24, label: t("map.lastDay") },
    { key: 24 * 7, label: t("map.lastWeek") },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t("map.advancedFilters")}>
      <Text variant="captionStrong" className="mb-2">
        {t("map.species")}
      </Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {species.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            selected={filters.species === s.key}
            onPress={() => onChange({ ...filters, species: s.key })}
          />
        ))}
      </View>
      <Text variant="captionStrong" className="mb-2">
        {t("map.distance")}
      </Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {distances.map((d) => (
          <Chip
            key={String(d)}
            label={d === null ? t("map.anyDistance") : formatDistance(d, locale)}
            selected={filters.maxDistance === d}
            onPress={() => onChange({ ...filters, maxDistance: d })}
          />
        ))}
      </View>
      <Text variant="captionStrong" className="mb-2">
        {t("map.reportedWithin")}
      </Text>
      <View className="mb-6 flex-row flex-wrap gap-2">
        {windows.map((w) => (
          <Chip
            key={String(w.key)}
            label={w.label}
            selected={filters.withinHours === w.key}
            onPress={() => onChange({ ...filters, withinHours: w.key })}
          />
        ))}
      </View>
      <View className="gap-3 pb-2">
        <Button label={`${t("map.apply")} (${resultCount})`} onPress={onClose} />
        <Button
          label={t("map.reset")}
          variant="ghost"
          onPress={() => onChange({ ...DEFAULT_FILTERS, kind: filters.kind, query: filters.query })}
        />
      </View>
    </Sheet>
  );
}
