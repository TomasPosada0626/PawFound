import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PetPhoto, UserAvatar } from "@/components/pets";
import { Card, EmptyState } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { shortName } from "@/domain/privacy";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackendState } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Ficha de una mascota de "Mis mascotas" vista desde el perfil de su familia. Solo llegan aquí sus
 * seguidores aceptados. Las señas particulares no se muestran: sirven para comprobar quién es la
 * familia si la mascota se pierde, y solo aparecen si se publica un reporte.
 */
export default function FriendPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const state = useBackendState();
  const pet = state.ownedPets.find((p) => p.id === id);
  const owner = pet ? state.users[pet.ownerId] : undefined;

  if (!pet) {
    return (
      <Screen header={<AppHeader left={<BackButton />} title={t("friendPet.title")} />}>
        <EmptyState icon="paw-outline" title={t("friendPet.notFound")} />
      </Screen>
    );
  }

  const [cover, ...more] = pet.photos;
  return (
    <Screen header={<AppHeader left={<BackButton />} title={pet.name} />} testID="friend-pet">
      <View className="items-center gap-2">
        {cover ? (
          <PetPhoto full pet={pet} className="h-56 w-full" rounded="rounded-3xl" label={t("pet.photoOf", { name: pet.name })} />
        ) : (
          <PetPhoto pet={pet} className="h-40 w-40" rounded="rounded-full" />
        )}
        {more.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} className="w-full">
            {more.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: 88, height: 88, borderRadius: 16 }}
                contentFit="cover"
                accessibilityLabel={t("pet.photoOf", { name: pet.name })}
              />
            ))}
          </ScrollView>
        ) : null}
        <Text variant="title" accessibilityRole="header" className="mt-2">
          {pet.name}
        </Text>
        <Text variant="body" tone="muted">
          {[t(`species.${pet.species}`), pet.breed].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <Card className="mt-4">
        <View className="flex-row flex-wrap">
          <Fact
            icon={pet.sex === "female" ? "female" : pet.sex === "male" ? "male" : "help"}
            label={t("pet.sex")}
            value={t(`sex.${pet.sex}`)}
          />
          <Fact icon="paw-outline" label={t("pet.age")} value={t(`age.${pet.age}`)} />
          <Fact icon="resize" label={t("pet.size")} value={t(`size.${pet.size}`)} />
          {pet.color ? <Fact icon="color-palette-outline" label={t("pet.color")} value={pet.color} /> : null}
          {pet.collar ? <Fact icon="ribbon-outline" label={t("pet.collar")} value={pet.collar} /> : null}
          {pet.shyOrIndoor ? <Fact icon="home-outline" label={t("friendPet.behavior")} value={t("friendPet.shy")} /> : null}
        </View>
        {pet.description ? (
          <View className="mt-1 gap-1">
            <Text variant="caption">{t("pet.description")}</Text>
            <Text variant="body">{pet.description}</Text>
          </View>
        ) : null}
      </Card>

      {owner ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/user/${owner.id}`)}
          className="mt-4 active:opacity-80"
          testID="friend-pet-owner"
        >
          <Card>
            <View className="flex-row items-center gap-3">
              <UserAvatar user={owner} size={44} />
              <View className="flex-1">
                <Text variant="caption">{t("friendPet.family")}</Text>
                <Text variant="bodyStrong">{shortName(owner.name)}</Text>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.muted} />
            </View>
          </Card>
        </Pressable>
      ) : null}
      <Text variant="caption" className="mt-3 text-center">
        {t("friendPet.privateNote")}
      </Text>
    </Screen>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View className="mb-3 w-1/2 flex-row gap-2 pr-2" accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={18} color={colors.primaryStrong} />
      <View className="flex-1">
        <Text variant="caption">{label}</Text>
        <Text variant="bodyStrong">{value}</Text>
      </View>
    </View>
  );
}
