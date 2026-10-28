import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { StoriesBar } from "@/components/StoriesBar";
import { AlertsOffBanner } from "@/components/AlertsOffBanner";
import { PawDecoration } from "@/components/brand";
import { HomeMenu } from "@/components/HomeMenu";
import { AppHeader, Screen } from "@/components/layout";
import { NotificationRow } from "@/components/notifications";
import { PetCard, PetPhoto, UserAvatar } from "@/components/pets";
import { Banner, Card, EmptyState, SectionHeader } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { OptionList, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { impactStats } from "@/domain/rules";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_FILTERS, filterPets, ownedPetsOf, userNotifications } from "@/services/selectors";
import { useBackendState, useCurrentUser } from "@/store/backend";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";
import { primaryGradient } from "@/theme/tokens";

export default function HomeScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const state = useBackendState();
  const user = useCurrentUser();
  const now = useNow();
  const { location } = useUserLocation();
  const requireAccount = useAuthGate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickPetOpen, setPickPetOpen] = useState(false);

  const nearby = useMemo(() => filterPets(state.pets, location, now, DEFAULT_FILTERS).slice(0, 10), [state.pets, location, now]);
  const stats = useMemo(() => impactStats(state.pets, now), [state.pets, now]);
  const notifications = useMemo(() => (user ? userNotifications(state, user.id) : []), [state, user]);
  const unreadNotifications = notifications.filter((n) => !n.read).length;
  const mostShared = useMemo(
    () =>
      user
        ? state.pets
            .filter((p) => p.ownerId === user.id && p.state === "active" && p.shareCount > 0)
            .sort((a, b) => b.shareCount - a.shareCount)[0]
        : undefined,
    [state.pets, user],
  );

  const openReport = () => {
    if (requireAccount("/report")) router.push("/report");
  };

  // Con perfiles en "Mis mascotas", la emergencia empieza eligiendo cuál se perdió.
  const ownedPets = useMemo(() => (user ? ownedPetsOf(state, user.id) : []), [state, user]);
  const openEmergency = () => {
    if (!requireAccount("/report")) return;
    if (ownedPets.length) setPickPetOpen(true);
    else router.push("/report");
  };

  const firstName = user?.name.split(" ")[0];

  return (
    <Screen
      withTabBar
      testID="home-screen"
      header={
        <AppHeader
          left={
            <IconButton
              icon="menu"
              label={t("home.menu")}
              onPress={() => setMenuOpen(true)}
              color={colors.ink}
              testID="open-menu"
            />
          }
          right={
            <IconButton
              icon="notifications-outline"
              label={t("home.notifications", { count: unreadNotifications })}
              color={colors.ink}
              badge={unreadNotifications > 0}
              onPress={() => router.push(user ? "/messages?tab=notifications" : "/auth/login")}
            />
          }
        />
      }
    >
      {/* Sin notificaciones o sin zona no llegan las alertas: la persona debe saberlo. */}
      {user ? (
        <View className="mt-3">
          <AlertsOffBanner userId={user.id} />
        </View>
      ) : null}

      {/* Saludo */}
      <View className="mt-3 flex-row items-center gap-4">
        {user ? (
          <UserAvatar user={user} size={76} ring />
        ) : (
          <View className="h-[76px] w-[76px] items-center justify-center rounded-full bg-primary-soft">
            <Icon name="paw" size={36} color={colors.primaryStrong} />
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text variant="title" className="shrink">
              {firstName ? t("home.greeting", { name: firstName }) : t("home.greetingGuest")}
            </Text>
            <Icon name="paw" size={20} color={colors.primary} />
          </View>
          <Text variant="body" tone="muted">
            {user ? t("home.subtitle") : t("home.guestSubtitle")}
          </Text>
          {!user ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push("/auth/login")}
              className="mt-1 min-h-[44px] justify-center"
            >
              <Text variant="bodyStrong" tone="primary">
                {t("home.signInPrompt")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Historias de los casos cerca: no vencen hasta que la mascota vuelve a casa */}
      <StoriesBar now={now} />

      {/* CTA Reportar */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("home.reportTitle")}. ${t("home.reportBody")}`}
        onPress={openReport}
        className="mt-5 overflow-hidden rounded-[28px] border border-border/60 bg-surface p-4 shadow-md shadow-black/10 active:opacity-90"
        testID="home-report-cta"
      >
        <PawDecoration size={70} className="absolute -right-2 -top-2" opacity={0.1} />
        <PawDecoration size={40} className="absolute bottom-1 left-24" opacity={0.07} />
        <View className="flex-row items-center gap-4">
          <LinearGradient
            colors={primaryGradient}
            style={{ width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="camera" size={38} color="#FFFFFF" />
          </LinearGradient>
          <View className="flex-1">
            <Text variant="heading">{t("home.reportTitle")}</Text>
            <Text variant="caption" tone="body">
              {t("home.reportBody")}
            </Text>
          </View>
          <View className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-sm shadow-black/15">
            <Icon name="arrow-forward" size={22} color={colors.primaryStrong} />
          </View>
        </View>
      </Pressable>

      {/* Emergencia: las primeras horas son las que más cuentan */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("home.emergencyTitle")}. ${t("home.emergencyBody")}`}
        onPress={openEmergency}
        className="mt-3 flex-row items-center gap-3 rounded-3xl border border-lost/30 bg-lost-soft p-4 active:opacity-90"
        testID="home-emergency"
      >
        <View className="h-12 w-12 items-center justify-center rounded-full bg-lost">
          <Icon name="alert" size={26} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text variant="subheading" tone="lost">
            {t("home.emergencyTitle")}
          </Text>
          <Text variant="caption" tone="body">
            {t("home.emergencyBody")}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color={colors.lostInk} />
      </Pressable>

      {/* Mascotas cerca */}
      <View className="mt-7">
        <SectionHeader
          title={t("home.nearby")}
          actionLabel={t("home.seeMap")}
          actionIcon="location"
          onAction={() => router.navigate("/map")}
        />
      </View>
      {nearby.length === 0 ? (
        <EmptyState icon="paw-outline" title={t("home.emptyNearby")} />
      ) : (
        <FlatList
          horizontal
          data={nearby}
          keyExtractor={(item) => item.pet.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 16, paddingBottom: 8 }}
          style={{ marginHorizontal: -16, paddingLeft: 16 }}
          renderItem={({ item }) => <PetCard pet={item.pet} distance={item.distance} now={now} />}
        />
      )}

      {/* Nuestro impacto: datos reales o un estado honesto (docs/flujos/mapa-e-inicio.md) */}
      <Card className="mt-6">
        <View className="mb-3 flex-row items-center gap-2">
          <Icon name="trending-up" size={22} color={colors.primaryStrong} />
          <Text variant="subheading" accessibilityRole="header">
            {t("home.impact")}
          </Text>
        </View>
        {stats ? (
          <View className="flex-row">
            <Stat icon="paw" value={String(stats.reunited)} label={t("home.impactReunited")} />
            <Stat icon="megaphone" value={String(stats.reportsThisMonth)} label={t("home.impactReports")} />
            <Stat icon="search" value={String(stats.activeCases)} label={t("home.impactActive")} />
            <Stat icon="heart" value={`${stats.reunitedWithin14DaysPct}%`} label={t("home.impactRate")} last />
          </View>
        ) : (
          <Text variant="caption">{t("home.impactNotEnough")}</Text>
        )}
      </Card>

      {/* Actividad reciente */}
      {user && (notifications.length > 0 || mostShared) ? (
        <View className="mt-7">
          <SectionHeader
            title={t("home.activity")}
            actionLabel={t("common.seeAll")}
            onAction={() => router.navigate("/messages?tab=notifications")}
          />
          <View className="gap-3">
            {mostShared ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/pet/${mostShared.id}`)}
                className="min-h-[64px] flex-row items-center gap-3 rounded-3xl border border-border/60 bg-surface p-3 active:opacity-80"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
                  <Icon name="share-social" size={22} color={colors.primaryStrong} />
                </View>
                <Text variant="body" className="flex-1">
                  {t("home.activityShared", { name: mostShared.name ?? t("common.unnamed"), count: mostShared.shareCount })}
                </Text>
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
            {notifications.slice(0, 2).map((n) => {
              const pet = state.pets.find((p) => p.id === n.petId);
              return pet ? <NotificationRow key={n.id} notification={n} pet={pet} now={now} /> : null;
            })}
          </View>
        </View>
      ) : null}

      <View className="mt-6">
        <Banner icon="flask-outline" body={t("common.demoBanner")} />
      </View>

      <HomeMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
      <Sheet visible={pickPetOpen} onClose={() => setPickPetOpen(false)} title={t("myPets.whichLost")} testID="pick-owned-pet">
        {ownedPets.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${t("myPets.lostCta")}: ${p.name}`}
            onPress={() => {
              setPickPetOpen(false);
              router.push({ pathname: "/report", params: { fromPet: p.id } });
            }}
            className="mb-2 min-h-[64px] flex-row items-center gap-3 rounded-2xl border border-border p-3 active:opacity-80"
            testID={`pick-${p.id}`}
          >
            <PetPhoto pet={p} className="h-12 w-12" rounded="rounded-full" />
            <Text variant="bodyStrong" className="flex-1">
              {p.name}
            </Text>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
        <OptionList
          options={[{ value: "other", label: t("myPets.otherPet"), icon: "add-circle-outline" as const }]}
          value={null}
          onSelect={() => {
            setPickPetOpen(false);
            router.push("/report");
          }}
        />
      </Sheet>
    </Screen>
  );
}

function Stat({ icon, value, label, last }: { icon: IconName; value: string; label: string; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label}`}
      className={last ? "flex-1 items-center gap-1 px-1" : "flex-1 items-center gap-1 border-r border-border px-1"}
    >
      <Icon name={icon} size={24} color={colors.primary} />
      <Text variant="heading">{value}</Text>
      <Text variant="caption" className="text-center">
        {label}
      </Text>
    </View>
  );
}
