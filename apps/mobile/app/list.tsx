import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PetRow } from "@/components/pets";
import { EmptyState } from "@/components/ui/Controls";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { Text } from "@/components/ui/Text";
import { distanceMeters } from "@/domain/geo";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_FILTERS, filterPets } from "@/services/selectors";
import { useBackendState, useCurrentUser } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useUserLocation } from "@/store/location";

type Filter = "nearby" | "mine" | "following";

/** Vista de lista ("Ver lista" del mapa, Mis reportes, Casos que sigo). */
export default function PetListScreen() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: Filter = params.filter === "mine" || params.filter === "following" ? params.filter : "nearby";
  const { t } = useI18n();
  const state = useBackendState();
  const user = useCurrentUser();
  const now = useNow();
  const { location } = useUserLocation();
  const { favorites } = useDevicePrefs();

  const rows = useMemo(() => {
    if (filter === "nearby") return filterPets(state.pets, location, now, DEFAULT_FILTERS);
    const pets =
      filter === "mine" ? state.pets.filter((p) => p.ownerId === user?.id) : state.pets.filter((p) => favorites.includes(p.id));
    return pets
      .map((pet) => ({ pet, distance: distanceMeters(location, pet.location) }))
      .sort((a, b) => b.pet.createdAt.localeCompare(a.pet.createdAt));
  }, [filter, state.pets, location, now, user, favorites]);

  const title = filter === "mine" ? t("list.mine") : filter === "following" ? t("list.following") : t("list.nearby");
  const empty =
    filter === "mine" ? t("list.emptyMine") : filter === "following" ? t("list.emptyFollowing") : t("home.emptyNearby");

  return (
    <Screen header={<AppHeader left={<BackButton />} />} testID="list-screen">
      <Text variant="title" className="mb-4 text-center" accessibilityRole="header">
        {title}
      </Text>
      {rows.length === 0 && filter === "nearby" && !state.nearbyLoaded ? (
        <View className="gap-3">
          {[0, 1, 2, 3].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState icon={filter === "following" ? "heart-outline" : "paw-outline"} title={empty} />
      ) : (
        <View className="gap-3">
          {rows.map((r) => (
            <PetRow key={r.pet.id} pet={r.pet} distance={r.distance} now={now} />
          ))}
        </View>
      )}
    </Screen>
  );
}
