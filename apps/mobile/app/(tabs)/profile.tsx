import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { BadgeHex, BadgeTile, BADGE_ORDER } from "@/components/badges";
import { AppHeader, Screen } from "@/components/layout";
import { PetAvatar, UserAvatar } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, Card, Divider, EmptyState, ListRow, SectionHeader } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ConfirmSheet, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useNow } from "@/hooks/useNow";
import { relativeTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { STORAGE_KEYS, writeJSON } from "@/services/storage";
import { userActivity, userBadges, userStats } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

export default function ProfileScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const now = useNow();
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const stats = useMemo(() => (user ? userStats(state, user.id) : null), [state, user]);
  const badges = useMemo(() => (user ? userBadges(state, user.id) : []), [state, user]);
  const activity = useMemo(() => (user ? userActivity(state, user.id).slice(0, 4) : []), [state, user]);

  if (!user || !stats) {
    return (
      <Screen withTabBar header={<AppHeader />} testID="profile-screen">
        <EmptyState
          icon="person-circle-outline"
          title={t("profile.guestTitle")}
          body={t("profile.guestBody")}
          action={
            <View className="gap-3">
              <Button label={t("auth.login")} onPress={() => router.push("/auth/login")} testID="profile-login" />
              <Button label={t("auth.create")} variant="outline" onPress={() => router.push("/auth/register")} />
            </View>
          }
        />
        <Card>
          <ListRow
            icon="help-circle-outline"
            tone="blue"
            title={t("settings.help")}
            onPress={() => router.push("/settings/support")}
          />
        </Card>
      </Screen>
    );
  }

  const logout = async () => {
    setLogoutOpen(false);
    await writeJSON(STORAGE_KEYS.session, null);
    await backend.logout();
    router.replace("/");
  };

  return (
    <Screen withTabBar header={<AppHeader />} testID="profile-screen">
      {/* Identidad */}
      <View className="mt-2 flex-row gap-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("profile.changePhoto")}
          onPress={() => router.push("/settings/edit-profile")}
        >
          <UserAvatar user={user} size={104} ring />
          <View className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-primary-strong">
            <Icon name="camera" size={16} color="#FFFFFF" />
          </View>
        </Pressable>
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-1.5">
            <Text variant="title" className="shrink" numberOfLines={2}>
              {user.name}
            </Text>
            {user.phoneVerified ? (
              <View accessible accessibilityLabel={t("common.verified")}>
                <Icon name="checkmark-circle" size={22} color={colors.verified} />
              </View>
            ) : null}
          </View>
          <Text variant="body" tone="muted">{`@${user.username}`}</Text>
          <View className="self-start rounded-full border border-border px-3 py-1">
            <Text variant="captionStrong">{t(`titles.${user.title}`)}</Text>
          </View>
          {user.bio ? (
            <Text variant="caption" tone="body">
              {user.bio}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="mt-3">
        <Button
          label={t("profile.editProfile")}
          icon="create-outline"
          variant="outline"
          compact
          onPress={() => router.push("/settings/edit-profile")}
          testID="edit-profile"
        />
      </View>

      {!user.phoneVerified ? (
        <View className="mt-4">
          <Banner
            tone="warning"
            icon="shield-outline"
            title={t("profile.unverified")}
            body={t("auth.addPhoneSubtitle")}
            action={
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: user.phone ? "/auth/verify" : "/auth/phone", params: { next: "/profile" } })
                }
                className="min-h-[40px] justify-center"
              >
                <Text variant="captionStrong" tone="primary">
                  {t("profile.verifyCta")}
                </Text>
              </Pressable>
            }
          />
        </View>
      ) : null}

      {/* Estadísticas */}
      <Card className="mt-5">
        <View className="flex-row">
          <Stat icon="paw" color={colors.lost} value={String(stats.reported)} label={t("profile.reported")} />
          <Stat icon="home" color={colors.primaryStrong} value={String(stats.found)} label={t("profile.foundStat")} />
          <Stat
            icon="star"
            color="#F5A524"
            value={stats.ratingAvg !== null ? stats.ratingAvg.toLocaleString(locale) : "—"}
            label={
              stats.ratingAvg !== null
                ? `${t("profile.rating")} ${t("profile.ratingCount", { count: stats.ratingCount })}`
                : t("profile.noRatings")
            }
          />
          <Stat icon="shield" color="#6D4AD6" value={String(badges.length)} label={t("profile.badges")} last />
        </View>
      </Card>

      {/* Insignias */}
      <Card className="mt-4">
        <SectionHeader title={t("profile.myBadges")} actionLabel={t("common.seeAll")} onAction={() => setBadgesOpen(true)} />
        {badges.length === 0 ? (
          <Text variant="caption">{t("profile.noBadges")}</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
            {badges.map((b) => (
              <BadgeTile key={b} id={b} />
            ))}
          </ScrollView>
        )}
      </Card>

      {/* Actividad */}
      <Card className="mt-4">
        <SectionHeader
          title={t("profile.activity")}
          actionLabel={t("common.seeAll")}
          onAction={() => router.push("/list?filter=mine")}
        />
        {activity.length === 0 ? (
          <Text variant="caption">{t("profile.noActivity")}</Text>
        ) : (
          activity.map((item, i) => (
            <View key={`${item.pet.id}-${item.kind}`}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/pet/${item.pet.id}`)}
                className="min-h-[76px] flex-row items-center gap-3 py-3 active:opacity-70"
              >
                <PetAvatar pet={item.pet} size={52} badgeIcon="paw" />
                <View className="flex-1">
                  <Text variant="bodyStrong" tone={item.kind === "lost" ? "lost" : "found"}>
                    {item.kind === "lost"
                      ? t("profile.activityLost")
                      : item.kind === "found"
                        ? t("profile.activityFound")
                        : t("profile.activityReunited")}
                  </Text>
                  <Text variant="caption" tone="body" numberOfLines={1}>
                    {`${item.pet.name ?? t("common.unnamed")}${item.pet.breed ? ` (${item.pet.breed})` : ""}`}
                  </Text>
                  <Text variant="caption" numberOfLines={1}>
                    {item.pet.zone}
                  </Text>
                </View>
                <Text variant="caption">{relativeTime(item.at, now, locale)}</Text>
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))
        )}
      </Card>

      {/* Ajustes */}
      <Card className="mt-4">
        <ListRow icon="person-outline" title={t("settings.personal")} onPress={() => router.push("/settings/edit-profile")} />
        <ListRow
          icon="notifications-outline"
          tone="warning"
          title={t("settings.notifications")}
          onPress={() => router.push("/settings/notifications")}
        />
        <ListRow
          icon="shield-checkmark-outline"
          tone="primary"
          title={t("settings.privacy")}
          onPress={() => router.push("/settings/privacy")}
        />
        <ListRow
          icon="help-circle-outline"
          tone="blue"
          title={t("settings.help")}
          onPress={() => router.push("/settings/support")}
        />
        <ListRow icon="log-out-outline" danger title={t("settings.logout")} onPress={() => setLogoutOpen(true)} testID="logout" />
      </Card>

      <Sheet
        visible={badgesOpen}
        onClose={() => setBadgesOpen(false)}
        title={t("badgesHow.title")}
        subtitle={t("badgesHow.subtitle")}
      >
        {BADGE_ORDER.map((id) => {
          const earned = badges.includes(id);
          return (
            <View key={id} className="flex-row items-center gap-4 border-b border-border py-3" accessible>
              <BadgeHex id={id} locked={!earned} size={56} />
              <View className="flex-1">
                <Text variant="bodyStrong">{t(`badges.${id}`)}</Text>
                <Text variant="caption">{t(`badgesHow.${id}`)}</Text>
              </View>
              <Text variant="label" tone={earned ? "primary" : "muted"}>
                {earned ? t("badgesHow.earned") : t("badgesHow.locked")}
              </Text>
            </View>
          );
        })}
      </Sheet>

      <ConfirmSheet
        visible={logoutOpen}
        title={t("settings.logoutConfirmTitle")}
        body={t("settings.logoutConfirmBody")}
        confirmLabel={t("settings.logout")}
        onConfirm={() => void logout()}
        onCancel={() => setLogoutOpen(false)}
      />
    </Screen>
  );
}

function Stat({
  icon,
  color,
  value,
  label,
  last,
}: {
  icon: IconName;
  color: string;
  value: string;
  label: string;
  last?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label}`}
      className={last ? "flex-1 items-center gap-1 px-1" : "flex-1 items-center gap-1 border-r border-border px-1"}
    >
      <Icon name={icon} size={26} color={color} />
      <Text variant="heading">{value}</Text>
      <Text variant="caption" className="text-center">
        {label}
      </Text>
    </View>
  );
}
