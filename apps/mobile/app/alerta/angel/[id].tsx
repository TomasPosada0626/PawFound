import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PawDecoration } from "@/components/brand";
import { BackButton } from "@/components/layout";
import { PetMap } from "@/components/map/PetMap";
import { PetPhoto, StatusBadge, petDisplayName } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, EmptyState } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { distanceMeters, formatDistance, regionForRadius } from "@/domain/geo";
import { currentRadius } from "@/domain/lifeCircle";
import { useNow } from "@/hooks/useNow";
import { useSharePet } from "@/hooks/useSharePet";
import { relativeTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useBackendState } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

/** Morado de la Alerta Ángel (Alerta Angel.png). Texto blanco sobre ambos tonos: contraste ≥ 5.8:1. */
const ANGEL_GRADIENT = ["#7B5BE3", "#5534C4"] as const;

/**
 * Pantalla de la Alerta Ángel: se abre al tocar la notificación push o el enlace
 * https://pawfound.pages.dev/alerta/angel/<id>. Prioriza las acciones que ayudan en los primeros
 * minutos: reconocerla (fotos), avisar si la vio y difundir.
 */
export default function AngelAlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const backend = useBackend();
  const state = useBackendState();
  const now = useNow(30_000);
  const share = useSharePet();

  const pet = state.pets.find((p) => p.id === id);
  const userId = state.sessionUserId;
  const zone = userId ? state.alertZones[userId] : undefined;
  const radius = pet ? currentRadius(pet, now) : 0;
  const region = useMemo(() => (pet ? regionForRadius(pet.location, Math.max(radius, 300)) : null), [pet, radius]);

  // Abrir la alerta la marca como leída en la bandeja.
  const unread = state.notifications.find(
    (n) => n.userId === userId && n.petId === id && (n.kind === "angel_alert" || n.kind === "life_circle") && !n.read,
  );
  useEffect(() => {
    if (unread) void backend.markNotificationRead(unread.id);
  }, [backend, unread]);

  if (!pet || !region) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
        <View className="px-4 pt-2">
          <BackButton />
        </View>
        <EmptyState
          icon="notifications-off-outline"
          title={t("angel.notFound")}
          action={<Button label={t("common.goHome")} onPress={() => router.replace("/")} />}
        />
      </View>
    );
  }

  const name = petDisplayName(pet, t);
  const active = pet.state === "active";
  const distance = zone ? distanceMeters(zone.location, pet.location) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="angel-alert">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}>
        <View className="mx-auto w-full max-w-[720px] gap-4 px-4">
          <View className="flex-row items-center gap-2">
            <BackButton fallback="/" />
            <Text variant="heading" accessibilityRole="header">
              {t("angel.title")}
            </Text>
          </View>

          <LinearGradient
            colors={ANGEL_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 28, padding: 20, overflow: "hidden" }}
          >
            <PawDecoration size={140} opacity={0.12} className="absolute -right-6 -top-6" />
            <View className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
                <Icon name="paw" size={26} color="#FFFFFF" />
              </View>
              <Text variant="label" tone="white" className="uppercase">
                {`🚨 ${t("angel.title")}`}
              </Text>
            </View>
            <Text variant="title" tone="white" className="mt-3">
              {t("angel.headline")}
            </Text>
            <Text variant="body" tone="white" className="mt-1">
              {t("angel.body")}
            </Text>
          </LinearGradient>

          {!active ? <Banner icon="home" body={t("angel.closed")} /> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}. ${t("angel.openCase")}`}
            onPress={() => router.push(`/pet/${pet.id}`)}
            className="overflow-hidden rounded-[28px] border border-border bg-surface active:opacity-90"
          >
            <PetPhoto pet={pet} className="h-64 w-full" rounded="rounded-none" />
            <View className="gap-2 p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="title" className="shrink" numberOfLines={1}>
                  {name}
                </Text>
                <StatusBadge kind={pet.kind} state={pet.state} />
              </View>
              {pet.breed || pet.color ? (
                <Text variant="body" tone="body">
                  {[pet.breed, pet.color].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
              <View className="mt-1 gap-2">
                <Fact icon="location-outline" label={`${pet.zone} · ${t("common.approxLocation")}`} />
                <Fact icon="time-outline" label={t("angel.lostAgo", { time: relativeTime(pet.lastSeenAt, now, locale) })} />
                {distance !== null ? (
                  <Fact icon="navigate-outline" label={t("angel.distance", { distance: formatDistance(distance, locale) })} />
                ) : null}
              </View>
            </View>
          </Pressable>

          <View className="overflow-hidden rounded-[28px] border border-border">
            <PetMap
              region={region}
              interactive={false}
              height={180}
              marker={{ coordinate: pet.location, kind: pet.kind, pet }}
              circles={[{ center: pet.location, radius, kind: pet.kind, variant: "current" }]}
              testID="angel-map"
            />
          </View>

          {active ? (
            <View className="gap-3">
              <Button
                label={t("angel.sawIt")}
                icon="eye"
                onPress={() => router.push(`/pet/${pet.id}/sighting`)}
                testID="angel-saw-it"
              />
              <Button label={t("angel.openCase")} icon="paw" variant="outline" onPress={() => router.push(`/pet/${pet.id}`)} />
              <Button
                label={t("angel.share")}
                icon="share-social-outline"
                variant="ghost"
                onPress={() => void share(pet)}
                testID="angel-share"
              />
            </View>
          ) : null}

          <Banner icon="information-circle-outline" body={t("angel.disclaimer")} />
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/settings/notifications")}
            className="min-h-[48px] flex-row items-center justify-center gap-2"
          >
            <Icon name="options-outline" size={18} color={colors.primaryStrong} />
            <Text variant="captionStrong" tone="primary">
              {t("angel.settings")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Fact({ icon, label }: { icon: IconName; label: string }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-2">
      <Icon name={icon} size={16} color={colors.primaryStrong} />
      <Text variant="caption" tone="body" className="flex-1">
        {label}
      </Text>
    </View>
  );
}
