import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReportUserSheet } from "@/components/ReportUserSheet";
import { BackButton } from "@/components/layout";
import { PetAvatar, UserAvatar } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, EmptyState, ListRow, ToggleRow } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Sheet } from "@/components/ui/Sheet";
import { cn, Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { shortName } from "@/domain/privacy";
import { localizedText, messageText, threadTitle } from "@/features/messages";
import { clockTime, shortDate } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { MESSAGE_MAX } from "@/services/mockBackend";
import { counterpart, threadMessages } from "@/services/selectors";
import { memberDays, mightBeOffensive } from "@/domain/moderation";
import { BackendError } from "@/services/backendTypes";
import type { User } from "@/domain/types";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useTheme } from "@/theme/ThemeProvider";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ user: User; messageId?: string } | null>(null);
  const [kindNudge, setKindNudge] = useState(false);
  const [originals, setOriginals] = useState<Set<string>>(new Set());
  const { autoTranslate, setAutoTranslate } = useDevicePrefs();
  const scroll = useRef<ScrollView>(null);

  const thread = state.threads.find((th) => th.id === id);
  const pet = thread?.petId ? state.pets.find((p) => p.id === thread.petId) : undefined;
  const messages = useMemo(() => {
    if (!thread) return [];
    return threadMessages(state, thread.id);
  }, [state, thread]);
  const isMember = Boolean(user && thread?.memberIds.includes(user.id));

  const threadId = thread?.id;
  useEffect(() => {
    if (isMember && threadId) void backend.markThreadRead(threadId);
  }, [backend, isMember, threadId, messages.length]);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: `/chat/${id}` } }} />;

  if (!thread || !isMember) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View className="px-4 pt-2">
          <BackButton fallback="/messages" />
        </View>
        <EmptyState icon="chatbubbles-outline" title={t("chat.notFound")} />
      </SafeAreaView>
    );
  }

  const other = counterpart(state, thread, user.id);
  const title = threadTitle(thread, pet, other, t, shortName);
  const muted = thread.mutedBy.includes(user.id);
  const isGroup = thread.kind === "group";

  const send = async (confirmed = false) => {
    const body = text.trim();
    if (!body) return;
    // Aviso amable (no censura): un tono respetuoso consigue más ayuda.
    if (!confirmed && mightBeOffensive(body)) {
      setKindNudge(true);
      return;
    }
    setKindNudge(false);
    setText("");
    try {
      await backend.sendMessage(thread.id, body, locale);
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setText(body);
      const code = error instanceof BackendError ? error.code : "unknown";
      toast(
        code === "muted"
          ? t("chat.mutedNotice", { date: shortDate(new Date(String((error as BackendError).params.until)), locale) })
          : code === "rate_limited"
            ? t("chat.rateLimited")
            : t("errors.unknown"),
        "error",
      );
    }
  };

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg }} testID="chat-screen">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Encabezado */}
        <View className="flex-row items-center gap-3 border-b border-border bg-surface px-3 py-2">
          <BackButton fallback="/messages" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${t("chat.viewCase")}`}
            onPress={() => pet && router.push(`/pet/${pet.id}`)}
            className="flex-1 flex-row items-center gap-3 active:opacity-80"
          >
            {!isGroup && other ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("publicProfile.view", { name: shortName(other.name) })}
                onPress={() => router.push(`/user/${other.id}`)}
                testID="dm-avatar"
              >
                <UserAvatar user={other} size={44} />
              </Pressable>
            ) : pet ? (
              <PetAvatar pet={pet} size={44} badgeIcon="people" />
            ) : null}
            <View className="flex-1">
              <Text variant="subheading" numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {isGroup
                  ? t("messages.members", { count: thread.memberIds.length })
                  : other
                    ? t("profile.memberDays", { count: memberDays(other.createdAt, new Date()) })
                    : pet
                      ? (pet.name ?? t("common.unnamed"))
                      : ""}
              </Text>
            </View>
          </Pressable>
          <IconButton
            icon="ellipsis-vertical"
            label={t("common.moreOptions")}
            color={colors.ink}
            onPress={() => setMenuOpen(true)}
          />
        </View>

        <ScrollView
          ref={scroll}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
        >
          <Banner icon="shield-checkmark-outline" body={isGroup ? t("chat.groupSafety") : t("chat.dmSafety")} />
          {messages.map((m) => {
            const mine = m.authorId === user.id;
            const localized = m.kind === "text" ? localizedText(m, locale, autoTranslate, originals.has(m.id)) : null;
            const body = localized ? localized.text : messageText(m, pet, t);
            const canToggle = Boolean(m.lang && m.lang !== locale && m.translations?.[locale]);
            const toggleOriginal = () =>
              setOriginals((prev) => {
                const next = new Set(prev);
                if (next.has(m.id)) next.delete(m.id);
                else next.add(m.id);
                return next;
              });
            if (m.kind !== "text") {
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole={m.kind === "sighting" ? "button" : "text"}
                  onPress={m.kind === "sighting" && pet ? () => router.push(`/pet/${pet.id}`) : undefined}
                  className={cn("self-center rounded-full px-4 py-2", m.kind === "sighting" ? "bg-lost-soft" : "bg-surface-alt")}
                >
                  <Text variant="caption" tone={m.kind === "sighting" ? "lost" : "muted"} className="text-center">
                    {body}
                  </Text>
                </Pressable>
              );
            }
            const author = state.users[m.authorId];
            return (
              <Pressable
                key={m.id}
                accessible
                accessibilityLabel={`${mine ? t("common.you") : m.authorShortName}: ${body}. ${clockTime(new Date(m.at), locale)}`}
                accessibilityHint={!mine && author ? t("chat.reportHint") : undefined}
                onLongPress={!mine && author ? () => setReportTarget({ user: author, messageId: m.id }) : undefined}
                testID={`message-${m.id}`}
                className={cn(
                  "max-w-[82%] rounded-3xl px-4 py-2.5",
                  mine
                    ? "self-end rounded-br-md bg-primary-strong"
                    : "self-start rounded-bl-md border border-border/60 bg-surface",
                )}
              >
                {isGroup && !mine ? (
                  author ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={t("publicProfile.view", { name: m.authorShortName })}
                      onPress={() => router.push(`/user/${author.id}`)}
                      hitSlop={10}
                      className="self-start"
                      testID={`author-${m.id}`}
                    >
                      <Text variant="label" tone="primary" className="underline">
                        {m.authorShortName}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text variant="label" tone="muted">
                      {t("common.deletedUser")}
                    </Text>
                  )
                ) : null}
                <Text variant="body" tone={mine ? "white" : "ink"}>
                  {body}
                </Text>
                {localized?.translatedFrom || localized?.untranslatedFrom || canToggle ? (
                  <Pressable
                    accessibilityRole={canToggle ? "button" : "text"}
                    onPress={canToggle ? toggleOriginal : undefined}
                    className="mt-1 min-h-[28px] flex-row items-center gap-1"
                    testID={`translation-${m.id}`}
                  >
                    <Icon name="language" size={13} color={mine ? "#FFFFFF" : colors.primaryStrong} />
                    <Text variant="label" tone={mine ? "white" : "primary"}>
                      {localized?.translatedFrom
                        ? `${t("chat.translatedFrom", { lang: t(`languages.${localized.translatedFrom}`) })} · ${t("chat.showOriginal")}`
                        : localized?.untranslatedFrom
                          ? t("chat.writtenIn", { lang: t(`languages.${localized.untranslatedFrom}`) })
                          : t("chat.showTranslation")}
                    </Text>
                  </Pressable>
                ) : null}
                <Text variant="label" tone={mine ? "white" : "muted"} className="mt-0.5 self-end opacity-80">
                  {clockTime(new Date(m.at), locale)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {thread.archived ? (
          <View className="p-4">
            <Banner icon="archive-outline" body={t("chat.archived")} />
          </View>
        ) : (
          <View className="flex-row items-end gap-2 border-t border-border bg-surface px-3 py-2">
            <TextInput
              accessibilityLabel={t("chat.placeholder")}
              placeholder={t("chat.placeholder")}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={MESSAGE_MAX}
              className="max-h-[120px] min-h-[48px] flex-1 rounded-3xl bg-surface-alt px-4 py-3 font-regular text-[15px] text-ink"
              testID="chat-input"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.send")}
              accessibilityState={{ disabled: !text.trim() }}
              disabled={!text.trim()}
              onPress={() => void send()}
              className={cn(
                "h-12 w-12 items-center justify-center rounded-full",
                text.trim() ? "bg-primary-strong" : "bg-border",
              )}
              testID="chat-send"
            >
              <Icon name="send" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={title}>
        {pet ? (
          <ListRow
            icon="paw-outline"
            title={t("chat.viewCase")}
            onPress={() => {
              setMenuOpen(false);
              router.push(`/pet/${pet.id}`);
            }}
          />
        ) : null}
        <ToggleRow
          icon="language"
          tone="blue"
          title={t("chat.autoTranslate")}
          description={t("chat.autoTranslateHint")}
          value={autoTranslate}
          onChange={setAutoTranslate}
          testID="toggle-auto-translate"
        />
        <ListRow
          icon={muted ? "notifications-outline" : "notifications-off-outline"}
          tone="neutral"
          title={muted ? t("chat.unmute") : t("chat.mute")}
          onPress={() => {
            void backend.toggleMute(thread.id);
            setMenuOpen(false);
          }}
        />
        {!isGroup && other ? (
          <ListRow
            icon="person-circle-outline"
            tone="violet"
            title={t("publicProfile.view", { name: shortName(other.name) })}
            onPress={() => {
              setMenuOpen(false);
              router.push(`/user/${other.id}`);
            }}
          />
        ) : null}
        {!isGroup && other ? (
          <ListRow
            icon="flag-outline"
            danger
            title={t("chat.reportUser", { name: shortName(other.name) })}
            onPress={() => {
              setMenuOpen(false);
              setReportTarget({ user: other });
            }}
            testID="report-user"
          />
        ) : (
          <Text variant="caption" className="mt-2">
            {t("chat.reportHint")}
          </Text>
        )}
      </Sheet>

      <ReportUserSheet
        target={reportTarget?.user ?? null}
        threadId={thread.id}
        messageId={reportTarget?.messageId}
        onClose={() => setReportTarget(null)}
      />

      <Sheet visible={kindNudge} onClose={() => setKindNudge(false)} title={t("chat.kindTitle")} testID="kind-nudge">
        <Text variant="body" className="mb-5">
          {t("chat.kindBody")}
        </Text>
        <View className="gap-3 pb-2">
          <Button label={t("chat.kindEdit")} onPress={() => setKindNudge(false)} />
          <Button label={t("chat.kindSend")} variant="ghost" onPress={() => void send(true)} testID="kind-send" />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
