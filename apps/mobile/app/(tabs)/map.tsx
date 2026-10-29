import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/components/layout";
import { PetMap } from "@/components/map/PetMap";
import { PlaceSheet } from "@/components/PlaceSheet";
import { PetCard, PetPhoto, petDisplayName, StatusBadge } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, Chip, ToggleRow } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { OptionList, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { distanceMeters, formatDistance, regionForRadius, type Region } from "@/domain/geo";
import { currentRadius, LIFE_CIRCLE_MAX } from "@/domain/lifeCircle";
import { clusterPets, type ClusterItem } from "@/domain/rules";
import type { LatLng, PetCase, Place } from "@/domain/types";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_FILTERS, filterPets, type KindFilter, type PetFilters } from "@/services/selectors";
import { useBackend, useBackendState } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

const DEFAULT_RADIUS = 2500;
/** La hoja "Mascotas cerca de ti" tapa cerca de la mitad inferior del mapa. */
const SHEET_SHARE = 0.45;
/** Más celdas = los pines solo se agrupan cuando de verdad se tocan. */
const CLUSTER_CELLS = 24;

/** Región que muestra un círculo completo en la parte del mapa que no tapa la hoja inferior. */
function regionAbove(center: LatLng, radius: number): Region {
  const base = regionForRadius(center, radius, 1.2 / (1 - SHEET_SHARE));
  return { ...base, latitude: center.latitude - base.latitudeDelta * (SHEET_SHARE / 2) };
}

/** Región que deja ver todas las mascotas (hasta 15 km a la redonda). */
function regionForAll(points: LatLng[], fallback: LatLng): Region {
  if (points.length === 0) return regionAbove(fallback, DEFAULT_RADIUS);
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const center = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
  const radius = Math.max(...points.map((p) => distanceMeters(center, p)));
  return regionAbove(center, Math.min(15_000, Math.max(800, radius)));
}

export default function MapScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const state = useBackendState();
  const now = useNow();
  const { location, hasRealLocation, status, request } = useUserLocation();
  const { locationConsent, prefsLoaded, setLocationConsent } = useDevicePrefs();
  const insets = useSafeAreaInsets();

  const [filters, setFilters] = useState<PetFilters>(DEFAULT_FILTERS);
  // Al abrir se ven todas las mascotas activas.
  const [target, setTarget] = useState<Region>(() =>
    regionForAll(
      filterPets(state.pets, location, now, DEFAULT_FILTERS).map((r) => r.pet.location),
      location,
    ),
  );
  // Mascota elegida en el mapa o en las tarjetas: se muestra solo ella con su círculo de vida.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [visible, setVisible] = useState<Region>(target);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [showCircles, setShowCircles] = useState(false);
  const [showPlaces, setShowPlaces] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);

  const results = useMemo(() => filterPets(state.pets, location, now, filters), [state.pets, location, now, filters]);
  const backend = useBackend();
  useEffect(() => {
    void backend.loadNearby(location).catch(() => {});
  }, [backend, location]);
  useEffect(() => {
    if (showPlaces) void backend.loadPlaces(location).catch(() => {});
  }, [backend, location, showPlaces]);
  const nearbyPlaces = useMemo(
    () => state.places.filter((p) => distanceMeters(location, p.location) <= 15_000),
    [state.places, location],
  );
  const focused = focusId ? state.pets.find((p) => p.id === focusId) : undefined;
  const clusters = useMemo<ClusterItem[]>(
    () =>
      focused
        ? [
            {
              id: focused.id,
              latitude: focused.location.latitude,
              longitude: focused.location.longitude,
              pets: [focused],
              majority: focused.kind,
            },
          ]
        : clusterPets(
            results.map((r) => r.pet),
            visible,
            CLUSTER_CELLS,
          ),
    [focused, results, visible],
  );
  const focusRadius = focused ? currentRadius(focused, now) : 0;
  // Perdida: círculo vigente relleno + anillo de 2 km hasta donde crecerá. Encontrada: sin
  // círculo, solo el pin donde la encontraron.
  const focusCircles = useMemo(
    () =>
      focused?.kind === "lost"
        ? [
            {
              id: `${focused.id}-now`,
              center: focused.location,
              radius: focusRadius,
              kind: focused.kind,
              variant: "focus" as const,
            },
            ...(focused.kind === "lost" && focusRadius < LIFE_CIRCLE_MAX
              ? [
                  {
                    id: `${focused.id}-max`,
                    center: focused.location,
                    radius: LIFE_CIRCLE_MAX,
                    kind: focused.kind,
                    variant: "future" as const,
                  },
                ]
              : []),
          ]
        : [],
    [focused, focusRadius],
  );

  const focusPet = (pet: PetCase) => {
    setFocusId(pet.id);
    setTarget(regionAbove(pet.location, pet.kind === "lost" ? LIFE_CIRCLE_MAX : 500));
  };
  const showAll = () => {
    setFocusId(null);
    setTarget(
      regionForAll(
        results.map((r) => r.pet.location),
        location,
      ),
    );
  };
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

  // La primera vez que se abre el mapa se pide la ubicación (primero el aviso de la app, luego
  // el permiso del sistema). Si ya la autorizó, se actualiza en silencio.
  useEffect(() => {
    if (!prefsLoaded) return;
    if (locationConsent === null) {
      const timer = setTimeout(() => setConsentOpen(true), 500);
      return () => clearTimeout(timer);
    }
    if (locationConsent === "granted" && !hasRealLocation) void request();
  }, [prefsLoaded, locationConsent, hasRealLocation, request]);

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
          circles={focused ? focusCircles : lifeCircles}
          onPetPress={focusPet}
          onClusterPress={zoomInto}
          pinLabel={pinLabel}
          clusterLabel={(c) => t("map.clusterLabel", { count: c.pets.length })}
          userLocation={hasRealLocation ? location : undefined}
          satellite={satellite}
          places={showPlaces ? nearbyPlaces : []}
          onPlacePress={setPlace}
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
          // Alto del menú inferior y del botón "+" que sobresale (~110) más la barra del sistema:
          // las tarjetas quedan completas, sin nada encima.
          style={{ paddingBottom: 112 + Math.max(insets.bottom, 10) }}
        >
          <View className="mb-2 h-1.5 w-12 self-center rounded-full bg-border" />
          {focused ? (
            <FocusPanel
              pet={focused}
              radius={focusRadius}
              distance={distanceMeters(location, focused.location)}
              onShowAll={showAll}
            />
          ) : (
            <>
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
                  renderItem={({ item }) => (
                    <PetCard pet={item.pet} distance={item.distance} now={now} width={164} onPress={() => focusPet(item.pet)} />
                  )}
                />
              )}
            </>
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
        <ToggleRow
          icon="medkit"
          tone="blue"
          title={t("places.layer")}
          description={t("places.layerHint")}
          value={showPlaces}
          onChange={setShowPlaces}
          testID="toggle-places"
        />
        {showPlaces && nearbyPlaces.length === 0 ? (
          <Banner icon="information-circle-outline" body={t("places.demoEmpty")} />
        ) : null}
      </Sheet>

      <PlaceSheet
        place={place}
        distance={place ? distanceMeters(location, place.location) : undefined}
        onClose={() => setPlace(null)}
      />

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

/**
 * Mascota elegida: foto, estado y su círculo de vida (cuánto mide ahora y hasta dónde
 * crecerá), con "Ver caso" y "Ver todas" para volver al mapa completo.
 */
function FocusPanel({
  pet,
  radius,
  distance,
  onShowAll,
}: {
  pet: PetCase;
  radius: number;
  distance: number;
  onShowAll: () => void;
}) {
  const { t, locale } = useI18n();
  const name = petDisplayName(pet, t);
  const lost = pet.kind === "lost";
  const color = lost ? statusColor.lost : statusColor.found;
  const pct = Math.min(100, Math.round((radius / LIFE_CIRCLE_MAX) * 100));
  return (
    <View
      className="px-4 pt-1"
      testID="map-focus"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t("map.focusLabel", { name })}
    >
      <View className="flex-row items-center gap-3">
        <PetPhoto pet={pet} className="h-20 w-20" />
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text variant="heading" numberOfLines={1} className="flex-shrink">
              {name}
            </Text>
            <StatusBadge kind={pet.kind} size="sm" />
          </View>
          <Text variant="caption" numberOfLines={1}>
            {`${pet.zone} · ${t("time.distanceAway", { distance: formatDistance(distance, locale) })}`}
          </Text>
        </View>
      </View>
      <View className="mt-3 rounded-2xl p-3" style={{ backgroundColor: lost ? "rgba(224,36,36,0.08)" : "rgba(18,179,166,0.1)" }}>
        <View className="flex-row items-center gap-2">
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
          <Text variant="bodyStrong" className="flex-1">
            {lost ? t("map.circleNow", { now: formatDistance(radius, locale) }) : t("map.foundHere")}
          </Text>
        </View>
        {lost ? (
          <>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-surface" accessible={false}>
              <View className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </View>
            <Text variant="caption" className="mt-1.5">
              {radius >= LIFE_CIRCLE_MAX
                ? t("map.circleAtMax", { max: formatDistance(LIFE_CIRCLE_MAX, locale) })
                : t("map.circleGrows", { max: formatDistance(LIFE_CIRCLE_MAX, locale) })}
            </Text>
          </>
        ) : null}
      </View>
      <View className="mt-3 flex-row gap-3">
        <Button
          label={t("map.viewCase")}
          icon="paw"
          compact
          className="flex-1"
          onPress={() => router.push(`/pet/${pet.id}`)}
          testID="map-focus-open"
        />
        <Button
          label={t("map.showAll")}
          icon="apps-outline"
          variant="outline"
          compact
          className="flex-1"
          onPress={onShowAll}
          testID="map-focus-all"
        />
      </View>
    </View>
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
