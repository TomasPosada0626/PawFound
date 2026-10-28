import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
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
import type { MessagePhoto, User } from "@/domain/types";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useTheme } from "@/theme/ThemeProvider";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  // Con la API trae lo más reciente de este chat (en la demostración no hace nada).
  useEffect(() => {
    if (id) void backend.loadThread(id).catch(() => {});
  }, [backend, id]);
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ user: User; messageId?: string } | null>(null);
  const [kindNudge, setKindNudge] = useState(false);
  const [originals, setOriginals] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState<MessagePhoto | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [viewer, setViewer] = useState<{ photo: MessagePhoto; label: string } | null>(null);
  const [confirm, setConfirm] = useState<"close" | "leave" | null>(null);
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

  const pickPhoto = async (source: "camera" | "library") => {
    setPhotoSheet(false);
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast(t("report.photoPermission"), "error");
      return;
    }
    // exif: false — la app no lee el GPS de la foto; el servidor además la re-codifica sin metadatos.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false };
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setPhoto({ uri: asset.uri, width: asset.width || 4, height: asset.height || 3 });
  };

  const canSend = Boolean(text.trim() || photo);

  const send = async (confirmed = false) => {
    const body = text.trim();
    const attached = photo;
    if (!body && !attached) return;
    // Aviso amable (no censura): un tono respetuoso consigue más ayuda.
    if (!confirmed && body && mightBeOffensive(body)) {
      setKindNudge(true);
      return;
    }
    setKindNudge(false);
    setText("");
    setPhoto(null);
    try {
      await backend.sendMessage(thread.id, body, locale, attached ?? undefined);
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setText(body);
      setPhoto(attached);
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
            const who = mine ? t("common.you") : m.authorShortName || t("common.deletedUser");
            const photoLabel = m.photo ? t("chat.photoFrom", { name: who }) : "";
            return (
              <Pressable
                key={m.id}
                accessible
                accessibilityLabel={`${who}: ${[photoLabel, body].filter(Boolean).join(". ")}. ${clockTime(new Date(m.at), locale)}`}
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
                {m.photo ? (
                  <Pressable
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`${photoLabel}. ${t("chat.viewPhoto")}`}
                    onPress={() => m.photo && setViewer({ photo: m.photo, label: photoLabel })}
                    className={cn("overflow-hidden rounded-2xl", body ? "mb-1.5" : "")}
                    testID={`photo-${m.id}`}
                  >
                    <Image
                      source={{ uri: m.photo.uri }}
                      style={{ width: 220, aspectRatio: Math.min(1.6, Math.max(0.6, m.photo.width / m.photo.height)) }}
                      contentFit="cover"
                      accessible={false}
                    />
                  </Pressable>
                ) : null}
                {body ? (
                  <Text variant="body" tone={mine ? "white" : "ink"}>
                    {body}
                  </Text>
                ) : null}
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
            <Banner
              icon="lock-closed-outline"
              body={
                thread.closedBy === user.id
                  ? t("chat.closedByMe")
                  : t("chat.closedByOther", { name: other ? shortName(other.name) : t("common.deletedUser") })
              }
            />
          </View>
        ) : (
          <View className="border-t border-border bg-surface px-3 py-2">
            {photo ? (
              <View className="mb-2 flex-row items-center gap-3 rounded-2xl bg-surface-alt p-2" testID="chat-photo-preview">
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: 56, height: 56, borderRadius: 12 }}
                  contentFit="cover"
                  accessible={false}
                />
                <Text variant="caption" className="flex-1">
                  {t("chat.photoPrivacy")}
                </Text>
                <IconButton
                  icon="close"
                  label={t("chat.removePhoto")}
                  color={colors.ink}
                  onPress={() => setPhoto(null)}
                  testID="chat-photo-remove"
                />
              </View>
            ) : null}
            <View className="flex-row items-end gap-2">
              <IconButton
                icon="image-outline"
                label={t("chat.attachPhoto")}
                color={colors.primaryStrong}
                onPress={() => setPhotoSheet(true)}
                testID="chat-attach"
              />
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
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                onPress={() => void send()}
                className={cn("h-12 w-12 items-center justify-center rounded-full", canSend ? "bg-primary-strong" : "bg-border")}
                testID="chat-send"
              >
                <Icon name="send" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
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
          icon={thread.archivedBy.includes(user.id) ? "file-tray-outline" : "archive-outline"}
          tone="neutral"
          title={thread.archivedBy.includes(user.id) ? t("chat.unarchive") : t("chat.archive")}
          onPress={() => {
            setMenuOpen(false);
            void backend
              .toggleArchive(thread.id)
              .then((archived) => toast(archived ? t("chat.archivedToast") : t("chat.unarchivedToast")));
          }}
          testID="chat-archive"
        />
        {!isGroup && !thread.archived ? (
          <ListRow
            icon="lock-closed-outline"
            tone="neutral"
            title={t("chat.closeDm")}
            description={t("chat.closeDmHint")}
            onPress={() => {
              setMenuOpen(false);
              setConfirm("close");
            }}
            testID="chat-close"
          />
        ) : null}
        <ListRow
          icon="trash-outline"
          danger
          title={t("chat.leave")}
          description={isGroup ? t("chat.leaveGroupHint") : t("chat.leaveHint")}
          onPress={() => {
            setMenuOpen(false);
            setConfirm("leave");
          }}
          testID="chat-leave"
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

      <Sheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title={t("chat.attachPhoto")} testID="chat-photo-sheet">
        <ListRow
          icon="camera-outline"
          title={t("chat.takePhoto")}
          onPress={() => void pickPhoto("camera")}
          testID="chat-photo-camera"
        />
        <ListRow
          icon="images-outline"
          title={t("chat.choosePhoto")}
          onPress={() => void pickPhoto("library")}
          testID="chat-photo-library"
        />
        <Text variant="caption" className="mt-2">
          {t("chat.photoPrivacy")}
        </Text>
      </Sheet>

      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View className="flex-1 bg-black" accessibilityViewIsModal testID="photo-viewer">
          <SafeAreaView edges={["top"]} className="flex-row justify-end px-3">
            <IconButton
              icon="close"
              label={t("chat.closePhoto")}
              color="#FFFFFF"
              onPress={() => setViewer(null)}
              testID="photo-viewer-close"
            />
          </SafeAreaView>
          {viewer ? (
            <Image
              source={{ uri: viewer.photo.uri }}
              style={{ flex: 1 }}
              contentFit="contain"
              accessible
              accessibilityLabel={viewer.label}
            />
          ) : null}
        </View>
      </Modal>

      <Sheet
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "close" ? t("chat.closeDm") : t("chat.leave")}
        testID="chat-confirm"
      >
        <Text variant="body" className="mb-5">
          {confirm === "close" ? t("chat.closeDmHint") : isGroup ? t("chat.leaveGroupHint") : t("chat.leaveHint")}
        </Text>
        <View className="gap-3 pb-2">
          <Button
            label={confirm === "close" ? t("chat.closeConfirm") : t("chat.leaveConfirm")}
            variant="danger"
            onPress={() => {
              const action = confirm;
              setConfirm(null);
              if (action === "close") void backend.closeDirect(thread.id);
              if (action === "leave") {
                void backend.leaveThread(thread.id);
                router.replace("/messages");
              }
            }}
            testID="chat-confirm-yes"
          />
          <Button label={t("common.cancel")} variant="ghost" onPress={() => setConfirm(null)} />
        </View>
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
