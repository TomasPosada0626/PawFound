import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/brand";
import { BackButton } from "@/components/layout";
import { LifeCircleCard } from "@/components/lifeCircle";
import { PetMap } from "@/components/map/PetMap";
import { PetPhoto, PetRow, StatusBadge, petDisplayName } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, Card, Divider, EmptyState, ListRow } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { ConfirmSheet, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { formatDistance, regionForRadius } from "@/domain/geo";
import { currentRadius, profileFor, radiusInFuture } from "@/domain/lifeCircle";
import { findPossibleMatches } from "@/domain/rules";
import { useAuthGate } from "@/hooks/useAuthGate";
import { SHARE_BASE_URL } from "@/config";
import { useNow } from "@/hooks/useNow";
import { relativeTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useTheme } from "@/theme/ThemeProvider";

export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tList, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const now = useNow(30_000);
  const toast = useToast();
  const requireAccount = useAuthGate();
  const { isFavorite, toggleFavorite } = useDevicePrefs();
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmReunite, setConfirmReunite] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewHours, setPreviewHours] = useState(0);

  const pet = state.pets.find((p) => p.id === id);
  const matches = useMemo(
    () => (pet && pet.state === "active" ? findPossibleMatches(pet, state.pets, now) : []),
    [pet, state.pets, now],
  );

  if (!pet) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
        <View className="px-4 pt-2">
          <BackButton />
        </View>
        <EmptyState
          icon="search-outline"
          title={t("pet.notFound")}
          action={<Button label={t("common.goHome")} onPress={() => router.replace("/")} />}
        />
      </View>
    );
  }

  const name = petDisplayName(pet, t);
  const isOwner = user?.id === pet.ownerId;
  const active = pet.state === "active";
  const radius = currentRadius(pet, now);
  const futureRadius = pet.kind === "lost" && previewHours > 0 ? radiusInFuture(pet, now, previewHours) : radius;
  const profile = profileFor(pet);
  const thread = state.threads.find((th) => th.id === pet.groupId);
  const isMember = Boolean(user && thread?.memberIds.includes(user.id));
  const favorite = isFavorite(pet.id);
  const statusLabel = pet.kind === "lost" ? t("status.lost") : t("status.found");

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      const code = error instanceof BackendError ? error.code : "unknown";
      toast(code === "cannot_message" ? t("chat.cannotMessage") : t("errors.unknown"), "error");
    } finally {
      setBusy(null);
    }
  };

  const openGroup = () => {
    if (!requireAccount(`/pet/${pet.id}`)) return;
    void run("group", async () => {
      const threadId = await backend.joinGroup(pet.id);
      router.push(`/chat/${threadId}`);
    });
  };

  const contact = () => {
    if (!requireAccount(`/pet/${pet.id}`)) return;
    void run("dm", async () => {
      const threadId = await backend.openDirect(pet.id);
      router.push(`/chat/${threadId}`);
    });
  };

  const share = async () => {
    setMoreOpen(false);
    try {
      const result = await Share.share({
        message: t("pet.shareMessage", {
          status: statusLabel.toUpperCase(),
          name,
          species: t(`speciesLower.${pet.species}`),
          zone: pet.zone,
          url: `${SHARE_BASE_URL}${pet.id}`,
        }),
      });
      if (result.action !== Share.dismissedAction) {
        await backend.sharePet(pet.id);
        toast(t("pet.shared"));
      }
    } catch {
      toast(t("errors.unknown"), "error");
    }
  };

  const reunite = () =>
    run("reunite", async () => {
      await backend.markReunited(pet.id);
      setConfirmReunite(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(t("pet.reunitedBanner", { name }));
    });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="pet-detail">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Mapa con el círculo de vida */}
        <View style={{ height: 360 + insets.top }}>
          <PetMap
            region={detailRegion(pet.location, Math.max(radius, futureRadius))}
            circles={[
              { center: pet.location, radius, kind: pet.kind, variant: "current" },
              ...(futureRadius > radius
                ? [{ center: pet.location, radius: futureRadius, kind: pet.kind, variant: "future" as const }]
                : []),
            ]}
            marker={{ coordinate: pet.location, kind: pet.kind, pet }}
            interactive={false}
            testID="detail-map"
          />
          <View className="absolute left-0 right-0 flex-row items-center justify-between px-4" style={{ top: insets.top + 8 }}>
            <BackButton />
            <View className="rounded-full bg-surface/80 px-3 py-1">
              <Wordmark size={24} />
            </View>
            <IconButton
              icon="ellipsis-horizontal"
              label={t("common.moreOptions")}
              variant="surface"
              color={colors.ink}
              onPress={() => setMoreOpen(true)}
              testID="more"
            />
          </View>
          <View
            accessible
            accessibilityLabel={`${pet.kind === "lost" ? t("pet.lifeRadius") : t("pet.foundRadius")}: ${formatDistance(radius, locale)}. ${t("pet.lastSeenAgo", { time: relativeTime(pet.lastSeenAt, now, locale) })}`}
            className="absolute items-center self-center rounded-2xl bg-surface px-5 py-2 shadow-md shadow-black/15"
            style={{ top: insets.top + 72 }}
            testID="radius-bubble"
          >
            <Text variant="caption" tone="body">
              {pet.kind === "lost" ? t("pet.lifeRadius") : t("pet.foundRadius")}
            </Text>
            <Text variant="title" tone="primary">
              {formatDistance(radius, locale)}
            </Text>
            <Text variant="caption" tone="body">
              {t("pet.lastSeenAgo", { time: relativeTime(pet.lastSeenAt, now, locale).toLowerCase() })}
            </Text>
            {futureRadius > radius ? (
              <Text variant="captionStrong" tone="lost" accessibilityLiveRegion="polite">
                {t("lifeCircle.previewing", { hours: previewHours, distance: formatDistance(futureRadius, locale) })}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="-mt-6 rounded-t-[28px] bg-surface px-4 pt-5">
          <View className="mx-auto w-full max-w-[720px]">
            {!active ? (
              <View className="mb-4">
                <Banner icon="home" title={t("pet.reunitedBanner", { name })} body={t("chat.archived")} />
              </View>
            ) : null}

            {/* Foto + identidad */}
            <View className="flex-row gap-4">
              <View>
                <PetPhoto pet={pet} className="h-44 w-36" label={t("pet.photoOf", { name })} />
                <View className="absolute left-2 top-2">
                  <StatusBadge kind={pet.kind} state={pet.state} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={favorite ? t("common.unfollowCase", { name }) : t("common.followCase", { name })}
                  accessibilityState={{ selected: favorite }}
                  onPress={() => toggleFavorite(pet.id)}
                  className="absolute bottom-1 right-1 h-12 w-12 items-center justify-center"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-surface shadow-sm shadow-black/20">
                    <Icon name={favorite ? "heart" : "heart-outline"} size={22} color={favorite ? colors.lost : colors.ink} />
                  </View>
                </Pressable>
              </View>
              <View className="flex-1 gap-1">
                <Text variant="title" accessibilityRole="header">
                  {name}
                </Text>
                <Text variant="body" tone="muted">
                  {pet.breed ?? t(`species.${pet.species}`)}
                </Text>
                <View className="mt-1 flex-row flex-wrap gap-2">
                  <Pill
                    icon={pet.sex === "female" ? "female" : pet.sex === "male" ? "male" : "help"}
                    label={t(`sex.${pet.sex}`)}
                  />
                  <Pill icon="paw" label={t(`ageShort.${pet.age}`)} />
                  <Pill icon="resize" label={t(`size.${pet.size}`)} />
                </View>
                {pet.reward && active ? (
                  <View className="mt-1 flex-row items-center gap-1">
                    <Icon name="gift-outline" size={16} color={colors.warning} />
                    <Text variant="captionStrong" tone="warning">
                      {t("pet.reward")}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Último avistamiento (zona aproximada, nunca dirección exacta) */}
            <View className="mt-4 flex-row items-start gap-3 rounded-2xl bg-surface-alt p-3">
              <Icon name="location" size={20} color={colors.primaryStrong} />
              <View className="flex-1">
                <View className="flex-row justify-between gap-2">
                  <Text variant="caption">{pet.kind === "lost" ? t("pet.lastSeen") : t("pet.foundAt")}</Text>
                  <Text variant="captionStrong" tone="primary">
                    {relativeTime(pet.lastSeenAt, now, locale)}
                  </Text>
                </View>
                <Text variant="bodyStrong">{pet.zone}</Text>
                <Text variant="caption">{t("pet.approxNote")}</Text>
              </View>
            </View>

            <View className="mt-4 flex-row flex-wrap">
              {pet.color ? <Detail icon="color-palette-outline" label={t("pet.color")} value={pet.color} /> : null}
              {pet.collar ? <Detail icon="ribbon-outline" label={t("pet.collar")} value={pet.collar} /> : null}
              {pet.marks ? <Detail icon="finger-print-outline" label={t("pet.marks")} value={pet.marks} /> : null}
              {pet.foundCondition ? (
                <Detail icon="medkit-outline" label={t("pet.condition")} value={t(`conditions.${pet.foundCondition}`)} />
              ) : null}
              {pet.foundCustody ? (
                <Detail icon="home-outline" label={t("pet.custody")} value={t(`custodies.${pet.foundCustody}`)} />
              ) : null}
            </View>

            <Divider className="my-3" />
            <Text variant="subheading">{t("pet.description")}</Text>
            <Text variant="body" className="mt-1">
              {pet.description}
            </Text>
            <Text variant="caption" className="mt-2">
              {isOwner ? t("pet.yourReport") : t("pet.reportedBy", { name: pet.ownerShortName })}
            </Text>

            {/* Acciones */}
            {active ? (
              <View className="mt-5 gap-3">
                {!isOwner && pet.kind === "lost" ? (
                  <Button
                    label={t("pet.sawIt")}
                    subtitle={t("pet.sawItHint")}
                    icon="eye"
                    variant="soft"
                    onPress={() => {
                      if (requireAccount(`/pet/${pet.id}/sighting`)) router.push(`/pet/${pet.id}/sighting`);
                    }}
                    testID="saw-it"
                  />
                ) : null}
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Button
                      label={t("pet.groupChat")}
                      subtitle={isMember ? t("pet.openGroup") : t("pet.joinGroup")}
                      icon="people"
                      variant="outline"
                      onPress={openGroup}
                      loading={busy === "group"}
                      testID="join-group"
                    />
                  </View>
                  {!isOwner ? (
                    <View className="flex-1">
                      <Button
                        label={pet.kind === "lost" ? t("pet.contactOwner") : t("pet.contactFinder")}
                        subtitle={t("pet.directMessage")}
                        icon="chatbubble-ellipses"
                        onPress={contact}
                        loading={busy === "dm"}
                        testID="contact"
                      />
                    </View>
                  ) : null}
                </View>
                {isOwner ? (
                  <Button
                    label={t("pet.reunite")}
                    subtitle={t("pet.reuniteHint")}
                    icon="home"
                    onPress={() => setConfirmReunite(true)}
                    testID="reunite"
                  />
                ) : null}
                <Button
                  label={t("common.share")}
                  icon="share-social-outline"
                  variant="ghost"
                  onPress={() => void share()}
                  testID="share"
                />
              </View>
            ) : null}

            {/* Cómo crece el círculo de vida, con vista previa en el mapa */}
            {active && pet.kind === "lost" ? (
              <View className="mt-5">
                <LifeCircleCard pet={pet} now={now} previewHours={previewHours} onPreview={setPreviewHours} />
              </View>
            ) : active ? (
              <View className="mt-5">
                <Banner icon="radio-button-on" body={t("lifeCircle.found")} />
              </View>
            ) : null}

            {/* Consejos según el perfil del círculo de vida */}
            {active ? (
              <Card className="mt-5 bg-surface-alt">
                <View className="flex-row items-center gap-2">
                  <Icon name="shield-checkmark-outline" size={22} color={colors.primaryStrong} />
                  <Text variant="subheading">
                    {isOwner ? t("pet.searchTips") : pet.kind === "lost" ? t("pet.seenTipsTitle") : t("pet.searchTips")}
                  </Text>
                </View>
                {!isOwner && pet.kind === "lost" ? (
                  <Text variant="caption" tone="body" className="mt-1">
                    {t("pet.seenTips")}
                  </Text>
                ) : null}
                <View className="mt-2 gap-2">
                  {tList(pet.kind === "found" ? "tips.found" : `tips.${profile}`).map((tip) => (
                    <View key={tip} className="flex-row gap-2">
                      <Text variant="caption" tone="primary">
                        •
                      </Text>
                      <Text variant="caption" tone="body" className="flex-1">
                        {tip}
                      </Text>
                    </View>
                  ))}
                </View>
                {pet.kind === "lost" ? (
                  <Text variant="caption" className="mt-2">
                    {`${t("report.lifeRadius")}: ${t(`profiles.${profile}`)}. ${t("pet.growsInfo")}`}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            {/* Avistamientos */}
            {pet.kind === "lost" ? (
              <View className="mt-6">
                <Text variant="heading" accessibilityRole="header" className="mb-2">
                  {t("pet.sightings")}
                </Text>
                {pet.sightings.length === 0 ? (
                  <Text variant="caption">{t("pet.noSightings")}</Text>
                ) : (
                  pet.sightings.map((s) => (
                    <View key={s.id} className="mb-3 flex-row gap-3">
                      <View className="items-center">
                        <View className="h-3 w-3 rounded-full bg-lost" />
                        <View className="w-0.5 flex-1 bg-border" />
                      </View>
                      <View className="flex-1 pb-1">
                        <Text variant="bodyStrong">{s.zone}</Text>
                        <Text variant="caption">
                          {t("pet.sightingBy", { name: s.authorShortName, time: relativeTime(s.at, now, locale).toLowerCase() })}
                        </Text>
                        {s.note ? (
                          <Text variant="caption" tone="body">
                            {`“${s.note}”`}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {/* Posibles coincidencias */}
            {matches.length > 0 ? (
              <View className="mt-6" testID="matches">
                <Text variant="heading" accessibilityRole="header">
                  {t("pet.possibleMatches")}
                </Text>
                <Text variant="caption" className="mb-3">
                  {t("pet.matchesHint")}
                </Text>
                <View className="gap-3">
                  {matches.map((m) => (
                    <PetRow key={m.pet.id} pet={m.pet} distance={m.distance} now={now} />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={t("common.moreOptions")}>
        <ListRow icon="share-social-outline" title={t("common.share")} onPress={() => void share()} />
        {!isOwner ? (
          <ListRow
            icon="flag-outline"
            tone="danger"
            title={t("pet.reportPost")}
            onPress={async () => {
              setMoreOpen(false);
              await backend.reportPost(pet.id);
              toast(t("pet.reportPostDone"), "info");
            }}
          />
        ) : null}
        {isOwner && active ? (
          <ListRow
            icon="home-outline"
            title={t("pet.reunite")}
            description={t("pet.reuniteHint")}
            onPress={() => {
              setMoreOpen(false);
              setConfirmReunite(true);
            }}
          />
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={confirmReunite}
        title={t("pet.reuniteConfirmTitle", { name })}
        body={t("pet.reuniteConfirmBody")}
        confirmLabel={t("pet.reuniteConfirm")}
        onConfirm={() => void reunite()}
        onCancel={() => setConfirmReunite(false)}
        loading={busy === "reunite"}
      />
    </View>
  );
}

/** Encuadre con el pin por debajo del centro, para que la burbuja del radio no lo tape. */
function detailRegion(center: { latitude: number; longitude: number }, radius: number) {
  const region = regionForRadius(center, radius, 1.7);
  return { ...region, latitude: center.latitude + region.latitudeDelta * 0.14 };
}

function Pill({ icon, label }: { icon: IconName; label: string }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-1 rounded-full bg-surface-alt px-3 py-1.5">
      <Icon name={icon} size={14} color={colors.primaryStrong} />
      <Text variant="captionStrong">{label}</Text>
    </View>
  );
}

function Detail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
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
