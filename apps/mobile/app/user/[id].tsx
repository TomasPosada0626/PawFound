import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState, useEffect } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { FounderTag } from "@/components/FounderTag";
import { BadgeTile } from "@/components/badges";
import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PetPhoto, UserAvatar } from "@/components/pets";
import { ReportUserSheet } from "@/components/ReportUserSheet";
import { Button } from "@/components/ui/Button";
import { Banner, Card, EmptyState, ListRow, SectionHeader } from "@/components/ui/Controls";
import { ConfirmSheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/Icon";
import { cn, Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { memberDays } from "@/domain/moderation";
import { formatRating } from "@/domain/rating";
import { shortName } from "@/domain/privacy";
import { useAuthGate } from "@/hooks/useAuthGate";
import { errorMessage } from "@/features/errorMessages";
import { shortDate } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { followInfoOf, hasLiked, likesOf, ownedPetsOf, userBadgeProgress, userStats } from "@/services/selectors";
import { useBackend, useBackendState } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Perfil público: lo que da confianza sin exponer datos de contacto. Días en PawFound, calificación,
 * insignias y "me gusta" de la comunidad. Ningún perfil es oculto: cualquiera puede abrirlo desde
 * un caso, un chat, un grupo o una búsqueda. La ubicación no se muestra a nadie, las mascotas solo
 * a sus seguidores aceptados, y de los seguidores se ven solo los números.
 */
export default function PublicProfileScreen() {
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  // Con la API trae lo más reciente de este perfil (en la demostración no hace nada).
  useEffect(() => {
    if (id) void backend.loadProfile(id).catch(() => {});
  }, [backend, id]);
  const state = useBackendState();
  const toast = useToast();
  const requireAccount = useAuthGate();
  const [reportOpen, setReportOpen] = useState(false);
  const [unfollowOpen, setUnfollowOpen] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const person = id ? state.users[id] : undefined;
  const viewerId = state.sessionUserId;
  const isSelf = viewerId === id;

  const badges = useMemo(() => (person ? userBadgeProgress(state, person.id).filter((b) => b.tier > 0) : []), [state, person]);
  const pets = useMemo(() => (person ? ownedPetsOf(state, person.id) : []), [state, person]);

  if (!person) {
    return (
      <Screen header={<AppHeader left={<BackButton />} title={t("publicProfile.title")} />}>
        <EmptyState icon="person-circle-outline" title={t("publicProfile.notFound")} />
      </Screen>
    );
  }

  const name = shortName(person.name);
  const likes = likesOf(state, person.id);
  const liked = hasLiked(state, viewerId, person.id);
  const stats = userStats(state, person.id);
  const days = memberDays(person.createdAt, new Date());
  const follow = followInfoOf(state, person.id);

  const toggleLike = async () => {
    if (!requireAccount(`/user/${person.id}`)) return;
    try {
      const nowLiked = await backend.toggleProfileLike(person.id);
      if (nowLiked) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      toast(t("publicProfile.likeVerify"), "error");
    }
  };

  const changeFollow = async (action: () => Promise<unknown>) => {
    if (!requireAccount(`/user/${person.id}`)) return;
    setFollowBusy(true);
    try {
      await action();
    } catch (err) {
      const code = err instanceof BackendError ? err.code : "unknown";
      toast(code === "not_allowed" ? t("network.followVerify") : errorMessage(code, t), "error");
    } finally {
      setFollowBusy(false);
      setUnfollowOpen(false);
    }
  };

  return (
    <Screen header={<AppHeader left={<BackButton />} title={t("publicProfile.title")} />} testID="public-profile">
      {preview && isSelf ? (
        <View className="mb-3">
          <Banner icon="eye-outline" body={t("publicProfile.previewBanner")} />
        </View>
      ) : null}

      {/* Identidad y confianza */}
      <View className="items-center gap-1 pt-2">
        <UserAvatar user={person} size={112} ring />
        <View className="mt-2 flex-row items-center gap-1.5">
          <Text variant="title" accessibilityRole="header">
            {name}
          </Text>
          {person.verified ? (
            <View accessible accessibilityLabel={t("common.verified")}>
              <Icon name="checkmark-circle" size={22} color={colors.verified} />
            </View>
          ) : null}
        </View>
        {person.founder ? <FounderTag /> : null}
        <Text variant="body" tone="muted">{`@${person.username}`}</Text>
        <View className="mt-1 rounded-full border border-border px-3 py-1">
          <Text variant="captionStrong">{t(`titles.${person.title}`)}</Text>
        </View>
        <View className="mt-2 flex-row items-center gap-1" accessible testID="public-member-days">
          <Icon name="calendar-outline" size={15} color={colors.primaryStrong} />
          <Text variant="captionStrong" tone="primary">
            {t("profile.memberDays", { count: days })}
          </Text>
          <Text variant="caption">{`· ${t("profile.memberSince", { date: shortDate(new Date(person.createdAt), locale) })}`}</Text>
        </View>
        <View className="mt-1 flex-row items-center gap-1" accessible testID="public-rating">
          <Icon name="star" size={16} color="#F5A524" />
          <Text variant="captionStrong">{formatRating(stats.ratingAvg, locale)}</Text>
          <Text variant="caption">
            {stats.ratingCount > 0 ? t("profile.ratingCount", { count: stats.ratingCount }) : t("profile.noRatings")}
          </Text>
        </View>
        {person.bio ? (
          <Text variant="body" className="mt-2 text-center">
            {person.bio}
          </Text>
        ) : null}
      </View>

      {/* Seguir: con solicitud y aceptación */}
      {!isSelf ? (
        <View className="mt-4 gap-2">
          <Button
            label={
              follow.status === "accepted"
                ? t("network.following")
                : follow.status === "pending"
                  ? t("network.requested")
                  : t("network.follow")
            }
            icon={
              follow.status === "accepted" ? "checkmark" : follow.status === "pending" ? "time-outline" : "person-add-outline"
            }
            variant={follow.status === "none" ? "primary" : "outline"}
            loading={followBusy}
            onPress={() => {
              if (follow.status === "accepted") setUnfollowOpen(true);
              else if (follow.status === "pending") void changeFollow(() => backend.unfollowUser(person.id));
              else void changeFollow(() => backend.followUser(person.id));
            }}
            testID="follow-user"
          />
          {follow.status === "none" ? (
            <Text variant="caption" className="text-center">
              {t("network.followHint")}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Me gusta */}
      <View className="mt-4 items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={liked ? t("publicProfile.unlikeLabel", { name }) : t("publicProfile.likeLabel", { name })}
          accessibilityState={{ selected: liked, disabled: isSelf }}
          disabled={isSelf}
          onPress={() => void toggleLike()}
          className={cn(
            "min-h-[52px] flex-row items-center gap-2 rounded-full px-6 active:opacity-80",
            liked ? "bg-[#E8466C]" : "border-2 border-[#E8466C] bg-surface",
            isSelf && "opacity-90",
          )}
          testID="like-profile"
        >
          <Icon name={liked ? "heart" : "heart-outline"} size={22} color={liked ? "#FFFFFF" : "#C42D52"} />
          <Text variant="subheading" style={{ color: liked ? "#FFFFFF" : "#C42D52" }}>
            {t("publicProfile.likes", { count: likes })}
          </Text>
        </Pressable>
        <Text variant="caption" className="text-center">
          {t("publicProfile.likeHint")}
        </Text>
      </View>

      {/* Seguidores: cualquiera ve el número; la lista solo la propia cuenta */}
      <Pressable
        accessibilityRole={isSelf ? "button" : undefined}
        disabled={!isSelf}
        onPress={() => router.push("/seguidores")}
        testID="public-followers"
      >
        <Card className="mt-4">
          <View className="flex-row">
            <MiniStat value={follow.followers} label={t("network.followers")} />
            <MiniStat value={follow.following} label={t("network.following")} last />
          </View>
        </Card>
      </Pressable>

      {/* Actividad real */}
      <Card className="mt-4">
        <View className="flex-row">
          <MiniStat value={stats.reported} label={t("profile.reported")} />
          <MiniStat value={stats.found} label={t("profile.foundStat")} />
          <MiniStat value={badges.length} label={t("profile.badges")} last />
        </View>
      </Card>

      {/* Insignias */}
      <Card className="mt-4">
        <SectionHeader title={t("publicProfile.badges")} />
        {badges.length === 0 ? (
          <Text variant="caption">{t("publicProfile.noBadges")}</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
            {badges.map((b) => (
              <BadgeTile key={b.id} progress={b} />
            ))}
          </ScrollView>
        )}
      </Card>

      {/* Mascotas: solo para sus seguidores; al tocarlas se abre su ficha */}
      <Card className="mt-4">
        <SectionHeader title={t("publicProfile.pets")} />
        {!isSelf && follow.status !== "accepted" ? (
          <Text variant="caption">{t("publicProfile.petsPrivate")}</Text>
        ) : pets.length === 0 ? (
          <Text variant="caption">{t("publicProfile.noPets")}</Text>
        ) : (
          <View className="flex-row flex-wrap gap-4" testID="public-pets">
            {pets.map((p) => (
              <Pressable
                key={p.id}
                className="w-[84px] items-center gap-1 active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel={`${p.name}, ${t(`species.${p.species}`)}`}
                accessibilityHint={t("friendPet.openHint")}
                onPress={() => router.push(`/user/mascota/${p.id}`)}
                testID={`friend-pet-${p.id}`}
              >
                <PetPhoto pet={p} className="h-20 w-20" rounded="rounded-full" />
                <Text variant="label" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text variant="caption">{t(`species.${p.species}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      {!isSelf ? (
        <Card className="mt-4">
          <ListRow icon="flag-outline" danger title={t("publicProfile.report", { name })} onPress={() => setReportOpen(true)} />
        </Card>
      ) : (
        <Card className="mt-4">
          <ListRow icon="create-outline" title={t("profile.editProfile")} onPress={() => router.push("/settings/edit-profile")} />
        </Card>
      )}
      <Text variant="caption" className="mt-3 text-center">
        {t("publicProfile.safe")}
      </Text>

      <ReportUserSheet target={reportOpen ? person : null} onClose={() => setReportOpen(false)} />
      <ConfirmSheet
        visible={unfollowOpen}
        danger
        loading={followBusy}
        title={t("network.unfollowTitle", { name })}
        body={t("network.unfollowBody")}
        confirmLabel={t("network.unfollow")}
        onCancel={() => setUnfollowOpen(false)}
        onConfirm={() => void changeFollow(() => backend.unfollowUser(person.id))}
      />
    </Screen>
  );
}

function MiniStat({ value, label, last }: { value: number; label: string; last?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label}`}
      className={last ? "flex-1 items-center gap-1 px-1" : "flex-1 items-center gap-1 border-r border-border px-1"}
    >
      <Text variant="heading">{String(value)}</Text>
      <Text variant="caption" className="text-center">
        {label}
      </Text>
    </View>
  );
}
