import { Redirect, router } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PetPhoto, PetRow } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, Card, EmptyState } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { ownedMatches } from "@/domain/matching";
import type { OwnedPet } from "@/domain/types";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_OWNED_PETS } from "@/services/mockBackend";
import { ownedPetsOf } from "@/services/selectors";
import { useBackendState, useCurrentUser } from "@/store/backend";

/** "Mis mascotas": perfiles preventivos para publicar un reporte de pérdida con un toque. */
export default function MyPetsScreen() {
  const { t } = useI18n();
  const state = useBackendState();
  const user = useCurrentUser();
  const now = useNow();
  const pets = useMemo(() => (user ? ownedPetsOf(state, user.id) : []), [state, user]);
  const zone = user ? state.alertZones[user.id] : undefined;
  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/my-pets" } }} />;

  const activeCase = (pet: OwnedPet) => {
    const found = pet.lastCaseId ? state.pets.find((p) => p.id === pet.lastCaseId) : undefined;
    return found?.state === "active" ? found : undefined;
  };

  return (
    <Screen header={<AppHeader left={<BackButton fallback="/profile" />} title={t("myPets.title")} />} testID="my-pets-screen">
      <Text variant="body" tone="muted" className="mb-4">
        {t("myPets.subtitle")}
      </Text>

      {pets.length === 0 ? (
        <EmptyState
          icon="paw-outline"
          title={t("myPets.title")}
          body={t("myPets.empty")}
          action={<Button label={t("myPets.add")} icon="add" onPress={() => router.push("/my-pets/edit")} testID="my-pets-add" />}
        />
      ) : (
        <View className="gap-3">
          {pets.map((pet) => {
            const lostCase = activeCase(pet);
            // "¿La encontraron?": solo si no tiene un reporte de pérdida activo (ese caso ya
            // recibe sus propias coincidencias).
            const matches = lostCase ? [] : ownedMatches(pet, zone?.location, state.pets).slice(0, 3);
            return (
              <Card key={pet.id} testID={`owned-${pet.id}`}>
                <View className="flex-row items-center gap-4">
                  <PetPhoto pet={pet} className="h-20 w-20" rounded="rounded-2xl" />
                  <View className="flex-1">
                    <Text variant="heading">{pet.name}</Text>
                    <Text variant="caption" numberOfLines={2}>
                      {[t(`species.${pet.species}`), pet.breed, pet.color].filter(Boolean).join(" · ")}
                    </Text>
                    {lostCase ? (
                      <Text variant="captionStrong" tone="lost" className="mt-1">
                        {t("myPets.activeCase")}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {matches.length ? (
                  <View className="mt-3 gap-2 rounded-2xl bg-found-soft p-3" testID={`matches-${pet.id}`}>
                    <Text variant="bodyStrong" tone="found">
                      {t("myPets.matches", { count: matches.length, name: pet.name })}
                    </Text>
                    <Text variant="caption">{t("myPets.matchesHint", { name: pet.name })}</Text>
                    {matches.map((m) => (
                      <PetRow key={m.pet.id} pet={m.pet} distance={m.distance} now={now} />
                    ))}
                  </View>
                ) : null}
                <View className="mt-3 flex-row gap-3">
                  <View className="flex-1">
                    <Button
                      label={t("myPets.edit")}
                      icon="create-outline"
                      variant="outline"
                      compact
                      onPress={() => router.push({ pathname: "/my-pets/edit", params: { id: pet.id } })}
                    />
                  </View>
                  <View className="flex-1">
                    {lostCase ? (
                      <Button
                        label={t("myPets.viewCase")}
                        icon="paw"
                        variant="soft"
                        compact
                        onPress={() => router.push(`/pet/${lostCase.id}`)}
                      />
                    ) : (
                      <Button
                        label={t("myPets.lostCta")}
                        icon="alert-circle"
                        variant="danger"
                        compact
                        onPress={() => router.push({ pathname: "/report", params: { fromPet: pet.id } })}
                        testID={`lost-${pet.id}`}
                      />
                    )}
                  </View>
                </View>
              </Card>
            );
          })}
          {pets.length < MAX_OWNED_PETS ? (
            <Button label={t("myPets.add")} icon="add" variant="ghost" onPress={() => router.push("/my-pets/edit")} />
          ) : (
            <Text variant="caption" className="text-center">
              {t("myPets.limit", { count: MAX_OWNED_PETS })}
            </Text>
          )}
        </View>
      )}

      {pets.length > 0 && !zone ? (
        <View className="mt-4 gap-2" testID="matches-need-zone">
          <Banner icon="search-outline" body={t("myPets.matchesNeedZone")} />
          <Button
            label={t("myPets.matchesZoneCta")}
            icon="location-outline"
            variant="ghost"
            onPress={() => router.push("/settings/notifications")}
          />
        </View>
      ) : null}

      <View className="mt-4">
        <Banner icon="lock-closed-outline" body={t("myPets.privateNote")} />
      </View>
    </Screen>
  );
}
