import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PetMap } from "@/components/map/PetMap";
import { PlaceSheet } from "@/components/PlaceSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState, IconBubble } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn, Text } from "@/components/ui/Text";
import { distanceMeters, formatDistance, regionForRadius } from "@/domain/geo";
import type { Place } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { vetSearchUrl } from "@/services/directions";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";

/** Solo las 5 más cercanas: en una urgencia, menos opciones es decidir más rápido. */
const MAX_RESULTS = 5;
const MAX_DISTANCE = 30_000;

/**
 * "Está herida: busquemos la veterinaria más cercana". Las 5 veterinarias más cercanas a la
 * persona (o a la zona del reporte si no comparte su ubicación), numeradas igual en el mapa y
 * en la lista. Al elegir una se ve su ficha y "Vamos" abre la ruta en Waze o Google Maps. Si
 * se abre desde un reporte de encontrada (`petId`), puede avisar en el grupo del caso.
 */
export default function VetsScreen() {
  const { petId } = useLocalSearchParams<{ petId?: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const { location, hasRealLocation, request } = useUserLocation();
  const { locationConsent } = useDevicePrefs();
  const [selected, setSelected] = useState<Place | null>(null);

  const pet = petId ? state.pets.find((p) => p.id === petId) : undefined;
  // Solo quien está en el grupo del caso puede avisar ahí (normalmente quien la encontró).
  const notifyThreadId =
    pet && user && pet.state === "active" && state.threads.some((th) => th.id === pet.groupId && th.memberIds.includes(user.id))
      ? pet.groupId
      : undefined;

  // La persona tocó "busquemos la veterinaria más cercana": se pide la ubicación del celular,
  // salvo que la haya rechazado en la app. Solo se usa en el dispositivo para medir distancias.
  useEffect(() => {
    if (locationConsent !== "denied") void request();
  }, [locationConsent, request]);

  const origin = hasRealLocation ? location : (pet?.location ?? location);
  useEffect(() => {
    void backend.loadPlaces(origin).catch(() => {});
  }, [backend, origin]);

  const vets = useMemo(
    () =>
      state.places
        .filter((p) => p.kind === "vet")
        .map((place) => ({ place, distance: distanceMeters(origin, place.location) }))
        .filter((v) => v.distance <= MAX_DISTANCE)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_RESULTS),
    [state.places, origin],
  );

  const region = useMemo(() => {
    if (selected) return regionForRadius(selected.location, 500);
    const farthest = vets[vets.length - 1];
    return regionForRadius(origin, Math.min(10_000, Math.max(600, farthest?.distance ?? 2_000)), 1.2);
  }, [selected, vets, origin]);

  const selectedDistance = selected ? distanceMeters(origin, selected.location) : undefined;

  return (
    <Screen testID="vets-screen" header={<AppHeader left={<BackButton />} />}>
      <View className="mt-1 flex-row items-center gap-3">
        <IconBubble icon="medkit" tone="lost" size={48} />
        <View className="flex-1">
          <Text variant="heading" accessibilityRole="header">
            {t("vets.title")}
          </Text>
          <Text variant="caption" tone="body">
            {t("vets.subtitle")}
          </Text>
        </View>
      </View>

      <View className="mt-4 overflow-hidden rounded-3xl border border-border/70 shadow-md shadow-black/10">
        <PetMap
          height={300}
          region={region}
          places={vets.map((v) => v.place)}
          numberedPlaces
          selectedPlaceId={selected?.id}
          onPlacePress={setSelected}
          userLocation={hasRealLocation ? location : undefined}
          marker={!hasRealLocation && pet ? { coordinate: pet.location, kind: pet.kind } : undefined}
          testID="vets-map"
        />
      </View>
      <View className="mt-2 flex-row items-center gap-1.5">
        <Icon name={hasRealLocation ? "navigate" : "location-outline"} size={14} color={colors.muted} />
        <Text variant="caption" className="flex-1">
          {hasRealLocation ? t("vets.fromYou") : t("vets.fromCase")}
        </Text>
      </View>

      {vets.length === 0 ? (
        <EmptyState icon="medkit-outline" title={t("vets.empty")} />
      ) : (
        <View className="mt-4 gap-3" testID="vets-list">
          {vets.map(({ place, distance }, index) => {
            const nearest = index === 0;
            return (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={t("vets.rowLabel", { name: place.name, distance: formatDistance(distance, locale) })}
                onPress={() => setSelected(place)}
                className={cn(
                  "flex-row items-center gap-3 rounded-3xl bg-surface p-4 shadow-sm shadow-black/5 active:opacity-80",
                  nearest ? "border-2 border-primary-strong" : "border border-border/60",
                )}
                testID={`vet-${place.id}`}
              >
                <View
                  className={cn("items-center justify-center rounded-full", nearest ? "h-12 w-12" : "h-10 w-10")}
                  style={{ backgroundColor: "#1D5FC9" }}
                >
                  <Text variant="subheading" tone="white" style={{ fontSize: nearest ? 20 : 16 }}>
                    {String(index + 1)}
                  </Text>
                </View>
                <View className="flex-1">
                  {nearest ? (
                    <View className="mb-1 self-start rounded-full bg-primary-soft px-2.5 py-0.5">
                      <Text variant="label" tone="primary">
                        {t("vets.nearest")}
                      </Text>
                    </View>
                  ) : null}
                  <Text variant={nearest ? "heading" : "bodyStrong"} numberOfLines={2}>
                    {place.name}
                  </Text>
                  {place.address ? (
                    <Text variant="caption" numberOfLines={1}>
                      {place.address}
                    </Text>
                  ) : null}
                  {place.emergency ? (
                    <View className="mt-1 flex-row items-center gap-1">
                      <Icon name="pulse" size={14} color={colors.lostInk} />
                      <Text variant="label" tone="lost">
                        {t("vets.emergency")}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View className="items-end gap-1">
                  <Text variant={nearest ? "title" : "heading"} tone="primary">
                    {formatDistance(distance, locale)}
                  </Text>
                  {place.phone ? (
                    <IconButton
                      icon="call"
                      label={t("places.call", { phone: place.phone })}
                      color={colors.primaryStrong}
                      onPress={() => void Linking.openURL(`tel:${place.phone?.replace(/[^\d+]/g, "")}`)}
                      testID={`vet-call-${place.id}`}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Solo si hay menos de 5 cerca (por ejemplo, fuera del Valle de Aburrá). */}
      {vets.length < MAX_RESULTS ? (
        <Button
          label={t("vets.searchGoogle")}
          icon="search"
          variant="ghost"
          className="mt-4"
          onPress={() => void Linking.openURL(vetSearchUrl(t("places.vet"))).catch(() => {})}
          testID="vets-search-google"
        />
      ) : null}
      <Text variant="caption" className="mt-4 text-center">
        {t("places.attribution")}
      </Text>

      <PlaceSheet
        place={selected}
        distance={selectedDistance}
        notifyThreadId={notifyThreadId}
        onClose={() => setSelected(null)}
      />
    </Screen>
  );
}
