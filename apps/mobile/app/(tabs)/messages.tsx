import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppHeader, Screen } from "@/components/layout";
import { NotificationRow } from "@/components/notifications";
import { KindTag, PetAvatar, StatusBadge, UserAvatar } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { EmptyState, IconBubble } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { UnderlineTabs } from "@/components/ui/Tabs";
import { cn, Text } from "@/components/ui/Text";
import { shortName } from "@/domain/privacy";
import type { AvatarId, PetCase, Thread } from "@/domain/types";
import { messagePreview, threadTitle } from "@/features/messages";
import { useNow } from "@/hooks/useNow";
import { chatTimestamp } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { counterpart, foldText, lastMessage, threadsForUser, unreadCount, userNotifications } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useTheme } from "@/theme/ThemeProvider";

type Tab = "chats" | "groups" | "notifications";

export default function MessagesScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const user = useCurrentUser();
  const state = useBackendState();
  const backend = useBackend();
  const now = useNow();
  const paramTab: Tab | null =
    params.tab === "groups" || params.tab === "notifications" || params.tab === "chats" ? params.tab : null;
  const [selected, setSelected] = useState<Tab | null>(null);
  const [lastParam, setLastParam] = useState(paramTab);
  // Si llega un ?tab= nuevo (p. ej. desde "Ver todas"), manda sobre la selección anterior.
  if (paramTab !== lastParam) {
    setLastParam(paramTab);
    setSelected(null);
  }
  const tab: Tab = selected ?? paramTab ?? "chats";
  const setTab = setSelected;
  const [query, setQuery] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { autoTranslate } = useDevicePrefs();

  const notifications = useMemo(() => (user ? userNotifications(state, user.id) : []), [state, user]);
  const unreadNotifications = notifications.some((n) => !n.read);

  const rows = useMemo(() => {
    if (!user || tab === "notifications") return [];
    const q = foldText(query.trim());
    return threadsForUser(state, user.id, tab === "chats" ? "dm" : "group")
      .filter((thread) => thread.archivedBy.includes(user.id) === showArchived)
      .map((thread) => {
        const pet = state.pets.find((p) => p.id === thread.petId);
        const other = counterpart(state, thread, user.id);
        const title = threadTitle(thread, pet, other, t, shortName);
        return { thread, pet, other, title, unread: unreadCount(state, thread, user.id), last: lastMessage(state, thread.id) };
      })
      .filter((r) => !q || foldText(`${r.title} ${r.pet?.name ?? ""} ${r.pet?.breed ?? ""}`).includes(q))
      .filter((r) => !onlyUnread || r.unread > 0);
  }, [state, user, tab, query, onlyUnread, showArchived, t]);

  const archivedCount = useMemo(
    () =>
      user && tab !== "notifications"
        ? threadsForUser(state, user.id, tab === "chats" ? "dm" : "group").filter((th) => th.archivedBy.includes(user.id)).length
        : 0,
    [state, user, tab],
  );

  const visibleNotifications = useMemo(() => {
    const q = foldText(query.trim());
    return notifications.filter((n) => {
      const pet = state.pets.find((p) => p.id === n.petId);
      if (!pet) return false;
      if (onlyUnread && n.read) return false;
      return !q || foldText(`${pet.name ?? ""} ${pet.zone} ${t(`notifications.${n.kind}`)}`).includes(q);
    });
  }, [notifications, state.pets, query, onlyUnread, t]);

  const placeholder =
    tab === "chats"
      ? t("messages.searchChats")
      : tab === "groups"
        ? t("messages.searchGroups")
        : t("messages.searchNotifications");

  return (
    <Screen withTabBar testID="messages-screen" header={<AppHeader title={t("messages.title")} />}>
      <Text variant="body" tone="muted" className="mb-4 text-center">
        {t("messages.subtitle")}
      </Text>

      {!user ? (
        <EmptyState
          icon="chatbubbles-outline"
          title={t("messages.guestTitle")}
          body={t("messages.guestBody")}
          action={
            <Button
              label={t("auth.login")}
              onPress={() => router.push({ pathname: "/auth/login", params: { next: "/messages" } })}
            />
          }
        />
      ) : (
        <>
          <View className="mb-3 flex-row items-center gap-2">
            <View className="min-h-[52px] flex-1 flex-row items-center gap-2 rounded-2xl border border-border/60 bg-surface px-4 shadow-sm shadow-black/5">
              <Icon name="search" size={20} color={colors.muted} />
              <TextInput
                accessibilityLabel={placeholder}
                placeholder={placeholder}
                placeholderTextColor={colors.muted}
                value={query}
                onChangeText={setQuery}
                className="flex-1 font-regular text-[15px] text-ink"
                testID="messages-search"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("messages.onlyUnread")}
              accessibilityState={{ selected: onlyUnread }}
              onPress={() => setOnlyUnread((v) => !v)}
              className={cn(
                "h-[52px] w-[52px] items-center justify-center rounded-2xl border shadow-sm shadow-black/5 active:opacity-80",
                onlyUnread ? "border-primary-strong bg-primary-soft" : "border-border/60 bg-surface",
              )}
            >
              <Icon name="options-outline" size={22} color={colors.primaryStrong} />
            </Pressable>
          </View>

          <UnderlineTabs<Tab>
            items={[
              { key: "chats", label: t("messages.tabChats"), icon: "chatbubble-ellipses-outline" },
              { key: "groups", label: t("messages.tabGroups"), icon: "people-outline" },
              {
                key: "notifications",
                label: t("messages.tabNotifications"),
                icon: "notifications-outline",
                badge: unreadNotifications,
              },
            ]}
            value={tab}
            onChange={setTab}
          />

          <View className="mt-4 gap-3">
            {tab === "notifications" ? (
              <>
                {unreadNotifications ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void backend.markAllNotificationsRead()}
                    className="min-h-[44px] justify-center self-end px-1"
                    testID="mark-all-read"
                  >
                    <Text variant="captionStrong" tone="primary">
                      {t("messages.markAllRead")}
                    </Text>
                  </Pressable>
                ) : null}
                {visibleNotifications.length === 0 ? (
                  <EmptyState
                    icon="notifications-off-outline"
                    title={query ? t("messages.noResults", { query }) : t("messages.emptyNotifications")}
                  />
                ) : (
                  visibleNotifications.map((n) => {
                    const pet = state.pets.find((p) => p.id === n.petId);
                    return pet ? <NotificationRow key={n.id} notification={n} pet={pet} now={now} /> : null;
                  })
                )}
              </>
            ) : null}
            {tab !== "notifications" && (archivedCount > 0 || showArchived) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowArchived((v) => !v)}
                className="min-h-[48px] flex-row items-center gap-3 rounded-2xl bg-surface-alt px-4"
                testID="toggle-archived"
              >
                <Icon name={showArchived ? "arrow-back" : "archive-outline"} size={20} color={colors.primaryStrong} />
                <Text variant="bodyStrong" tone="primary">
                  {showArchived ? t("messages.backToInbox") : t("messages.archived", { count: archivedCount })}
                </Text>
              </Pressable>
            ) : null}
            {tab === "notifications" ? null : rows.length === 0 ? (
              <EmptyState
                icon={tab === "chats" ? "chatbubble-ellipses-outline" : "people-outline"}
                title={
                  query
                    ? t("messages.noResults", { query })
                    : tab === "chats"
                      ? t("messages.emptyChats")
                      : t("messages.emptyGroups")
                }
              />
            ) : (
              rows.map((r) => (
                <ThreadRow
                  key={r.thread.id}
                  thread={r.thread}
                  title={r.title}
                  preview={messagePreview(r.last, r.pet, user.id, t, locale, autoTranslate)}
                  time={r.last ? chatTimestamp(r.last.at, now, locale) : ""}
                  unread={r.unread}
                  muted={r.thread.mutedBy.includes(user.id)}
                  pet={r.pet}
                  otherIsOwner={Boolean(r.other && r.pet && r.other.id === r.pet.ownerId)}
                  otherAvatar={r.other}
                />
              ))
            )}
          </View>

          {/* Toda la tarjeta abre soporte: con un botón al lado, el texto quedaba en una columna angosta. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("messages.contactSupport")}
            onPress={() => router.push("/settings/support")}
            className="mt-5 min-h-[72px] flex-row items-center gap-3 rounded-3xl border border-border/60 bg-surface p-4 active:opacity-80"
          >
            <IconBubble icon="chatbubbles-outline" />
            <View className="flex-1">
              <Text variant="bodyStrong">{t("messages.needHelp")}</Text>
              <Text variant="caption">{t("messages.helpBody")}</Text>
              <Text variant="captionStrong" tone="primary" className="mt-1">
                {t("messages.contactSupport")}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </>
      )}
    </Screen>
  );
}

function ThreadRow({
  thread,
  title,
  preview,
  time,
  unread,
  muted,
  pet,
  otherIsOwner,
  otherAvatar,
}: {
  thread: Thread;
  title: string;
  preview: string;
  time: string;
  unread: number;
  muted: boolean;
  pet: PetCase | undefined;
  otherIsOwner: boolean;
  otherAvatar?: { avatar: AvatarId };
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const petCase = pet;
  const petName = petCase?.name ?? t("common.unnamed");
  const isGroup = thread.kind === "group";
  const members = thread.memberIds.length;
  const label = [
    title,
    preview,
    time,
    unread > 0 ? t("messages.unread", { count: unread }) : null,
    muted ? t("messages.muted") : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(`/chat/${thread.id}`)}
      className="min-h-[88px] flex-row items-center gap-3 rounded-3xl border border-border/60 bg-surface p-3 active:opacity-80"
      testID={`thread-${thread.id}`}
    >
      {petCase ? (
        <PetAvatar pet={petCase} size={64} badgeIcon={isGroup ? "people" : null} />
      ) : otherAvatar ? (
        <UserAvatar user={otherAvatar} size={64} />
      ) : null}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="subheading" numberOfLines={1} className="shrink">
            {title}
          </Text>
          <Text variant="caption">{time}</Text>
        </View>
        {petCase ? (
          <View className="flex-row flex-wrap items-center gap-1.5">
            {isGroup ? (
              thread.archived ? (
                <StatusBadge kind={petCase.kind} state={petCase.state} size="sm" />
              ) : (
                <KindTag kind={petCase.kind} label={petCase.kind === "lost" ? t("status.lostPet") : t("status.foundPet")} />
              )
            ) : (
              <KindTag
                kind={petCase.kind}
                label={
                  otherIsOwner
                    ? petCase.kind === "lost"
                      ? t("messages.familyOf", { name: petName })
                      : t("messages.foundBy", { name: petName })
                    : petName
                }
              />
            )}
            {isGroup && petCase.breed ? (
              <Text variant="caption" numberOfLines={1}>
                {`· ${petCase.breed}`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {isGroup ? (
          <View className="flex-row items-center gap-1">
            <Icon name="people" size={13} color={colors.muted} />
            <Text variant="caption">{t("messages.members", { count: members })}</Text>
          </View>
        ) : null}
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="caption" tone="body" numberOfLines={1} className="flex-1">
            {preview}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {muted ? <Icon name="notifications-off-outline" size={16} color={colors.muted} /> : null}
            {unread > 0 ? (
              <View
                className={cn(
                  "h-6 min-w-[24px] items-center justify-center rounded-full px-1.5",
                  petCase?.kind === "lost" && isGroup ? "bg-lost" : "bg-primary-strong",
                )}
              >
                <Text variant="label" tone="white">
                  {String(unread)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
