import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { petDisplayName } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { useSeenStories } from "@/hooks/useSeenStories";
import { useSharePet } from "@/hooks/useSharePet";
import { relativeTime, shortDate } from "@/i18n/format";
import type { PetCase } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { storySlides, type StorySlide } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

const SLIDE_MS = 6000;
const COLORS = { lost: ["#E0455A", "#7E1424"], found: ["#16A088", "#08463C"] } as const;

/**
 * Historia de un caso a pantalla completa. No vence: sigue aquí hasta que la mascota vuelve a
 * casa o la familia quita sus actualizaciones. Tocar a la derecha avanza, a la izquierda
 * retrocede y mantener presionado pausa. Con lector de pantalla no avanza sola.
 */
export default function StoryViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const sharePet = useSharePet();
  const { markSeen } = useSeenStories();
  const pet = state.pets.find((p) => p.id === id && p.state === "active" && !p.moderationRemoved);
  const slides = useMemo(() => (pet ? storySlides(pet, state.stories) : []), [pet, state.stories]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [adding, setAdding] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const isOwner = Boolean(user && pet && user.id === pet.ownerId);
  const slide = slides[Math.min(index, slides.length - 1)];

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
  }, []);

  useEffect(() => {
    if (slide) markSeen(slide.id);
  }, [slide, markSeen]);

  const next = () => {
    if (index >= slides.length - 1) router.back();
    else setIndex((i) => i + 1);
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    progress.setValue(0);
    if (paused || screenReader || adding || !slides.length) return;
    const anim = Animated.timing(progress, { toValue: 1, duration: SLIDE_MS, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished }) => finished && next());
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, screenReader, adding, slides.length]);

  if (!pet || !slide) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-black px-6" testID="story-viewer-empty">
        <Icon name="home" size={44} color="#FFFFFF" />
        <Text variant="subheading" tone="white" className="text-center">
          {t("stories.gone")}
        </Text>
        <Button label={t("common.close")} variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const name = petDisplayName(pet, t);
  const removeCurrent = async () => {
    if (slide.type !== "update") return;
    await backend.removeStory(slide.id);
    toast(t("stories.removed"), "info");
    setIndex((i) => Math.max(0, i - 1));
  };

  return (
    <View className="flex-1 bg-black" testID="story-viewer">
      <SlideContent slide={slide} pet={pet} name={name} locale={locale} />

      {/* Toques: izquierda retrocede, derecha avanza, mantener pausa. */}
      <View className="absolute inset-0 flex-row" accessible={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("stories.prev")}
          className="flex-[3]"
          onPress={prev}
          onLongPress={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
          testID="story-prev"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("stories.next")}
          className="flex-[7]"
          onPress={next}
          onLongPress={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
          testID="story-next"
        />
      </View>

      <SafeAreaView edges={["top"]} className="absolute left-0 right-0 top-0 px-3 pt-2" pointerEvents="box-none">
        <View
          className="flex-row gap-1"
          accessible
          accessibilityLabel={t("stories.position", { current: index + 1, total: slides.length })}
        >
          {slides.map((s, i) => (
            <View key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
              <Animated.View
                style={{
                  height: 3,
                  backgroundColor: "#FFFFFF",
                  width:
                    i < index
                      ? "100%"
                      : i === index
                        ? progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] })
                        : "0%",
                }}
              />
            </View>
          ))}
        </View>
        <View className="mt-3 flex-row items-center gap-3">
          {pet.photos[0] ? (
            <Image source={{ uri: pet.photos[0] }} style={{ width: 36, height: 36, borderRadius: 18 }} accessible={false} />
          ) : null}
          <View className="flex-1">
            <Text variant="bodyStrong" tone="white" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" tone="white" className="opacity-80" numberOfLines={1}>
              {`${pet.kind === "lost" ? t("stories.lost") : t("stories.found")} · ${pet.zone}`}
            </Text>
          </View>
          <IconButton icon="close" label={t("common.close")} color="#FFFFFF" onPress={() => router.back()} testID="story-close" />
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0 gap-2 px-4 pb-3" pointerEvents="box-none">
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              label={t("stories.viewCase")}
              icon="paw"
              variant="soft"
              compact
              onPress={() => router.replace(`/pet/${pet.id}`)}
              testID="story-view-case"
            />
          </View>
          {pet.kind === "lost" && !isOwner ? (
            <View className="flex-1">
              <Button
                label={t("stories.sawIt")}
                icon="eye"
                compact
                onPress={() => router.replace(`/pet/${pet.id}/sighting`)}
                testID="story-saw-it"
              />
            </View>
          ) : null}
          <IconButton
            icon="share-social"
            label={t("common.share")}
            color="#FFFFFF"
            onPress={() => void sharePet(pet)}
            testID="story-share"
          />
        </View>
        {isOwner ? (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                label={t("stories.add")}
                icon="add-circle-outline"
                variant="ghost"
                compact
                onPress={() => setAdding(true)}
                testID="story-add"
              />
            </View>
            {slide.type === "update" ? (
              <Button
                label={t("stories.remove")}
                icon="trash-outline"
                variant="ghost"
                compact
                onPress={() => void removeCurrent()}
                testID="story-remove"
              />
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>

      <AddUpdateSheet
        petId={pet.id}
        visible={adding}
        onClose={() => setAdding(false)}
        onPublished={() => setIndex(slides.length)}
      />
    </View>
  );
}

function SlideContent({ slide, pet, name, locale }: { slide: StorySlide; pet: PetCase; name: string; locale: string }) {
  const { t } = useI18n();
  if (slide.type === "info") {
    return (
      <LinearGradient
        colors={COLORS[pet.kind]}
        style={{ flex: 1 }}
        accessible
        accessibilityLabel={slideLabel(slide, pet, name, t)}
      >
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text variant="display" tone="white" className="text-center text-[44px] leading-[50px]">
            {pet.kind === "lost" ? t("story.headlineLost") : t("story.headlineFound")}
          </Text>
          {pet.photos[0] ? (
            <Image
              source={{ uri: pet.photos[0] }}
              style={{ width: 220, height: 220, borderRadius: 110, borderWidth: 6, borderColor: "#FFFFFF" }}
              contentFit="cover"
              accessible={false}
            />
          ) : null}
          <Text variant="display" tone="white" className="text-center">
            {name}
          </Text>
          <Text variant="bodyStrong" tone="white" className="text-center">
            {`${pet.kind === "lost" ? t("stories.infoLost", { zone: pet.zone }) : t("stories.infoFound", { zone: pet.zone })} · ${shortDate(new Date(pet.lastSeenAt), locale as "es")}`}
          </Text>
          <Text variant="caption" tone="white" className="mt-2 text-center opacity-85">
            {t("stories.persist", { name })}
          </Text>
        </View>
      </LinearGradient>
    );
  }
  return (
    <View className="flex-1 justify-center" accessible accessibilityLabel={slideLabel(slide, pet, name, t)}>
      {slide.uri ? <Image source={{ uri: slide.uri }} style={{ flex: 1 }} contentFit="contain" accessible={false} /> : null}
      {slide.type === "update" ? (
        <View className={slide.uri ? "absolute bottom-40 left-4 right-4" : "mx-6"}>
          <View className="gap-1 rounded-3xl bg-black/60 p-4">
            <Text variant="captionStrong" tone="white" className="opacity-80">
              {`${t("stories.updateBy")} · ${relativeTime(slide.at, new Date(), locale as "es")}`}
            </Text>
            {slide.text ? (
              <Text variant="subheading" tone="white">
                {slide.text}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function slideLabel(slide: StorySlide, pet: { kind: string; zone: string }, name: string, t: ReturnType<typeof useI18n>["t"]) {
  if (slide.type === "info")
    return `${pet.kind === "lost" ? t("story.headlineLost") : t("story.headlineFound")}: ${name}, ${pet.zone}`;
  if (slide.type === "photo") return t("stories.photoOf", { name });
  return `${t("stories.updateBy")}: ${slide.text}`;
}

function AddUpdateSheet({
  petId,
  visible,
  onClose,
  onPublished,
}: {
  petId: string;
  visible: boolean;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast(t("report.photoPermission"), "error");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
  };

  const publish = async () => {
    setBusy(true);
    try {
      await backend.addStory(petId, { text, photo: photo ?? undefined });
      setText("");
      setPhoto(null);
      onClose();
      onPublished();
      toast(t("stories.published"));
    } catch (e) {
      toast(
        e instanceof BackendError && e.code === "story_full" ? t("stories.limit", { count: 20 }) : t("errors.unknown"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("stories.addTitle")} testID="story-add-sheet">
      <TextInput
        accessibilityLabel={t("stories.addPlaceholder")}
        placeholder={t("stories.addPlaceholder")}
        value={text}
        onChangeText={setText}
        maxLength={140}
        multiline
        className="min-h-[88px] rounded-2xl bg-surface-alt p-4 font-regular text-[15px] text-ink"
        testID="story-add-text"
      />
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: 96, height: 96, borderRadius: 16, marginTop: 12 }} accessible={false} />
      ) : null}
      <View className="mt-4 gap-3 pb-2">
        <Button
          label={t("stories.addPhoto")}
          icon="image-outline"
          variant="ghost"
          onPress={() => void pick()}
          testID="story-add-photo"
        />
        <Button
          label={t("stories.publish")}
          onPress={() => void publish()}
          loading={busy}
          disabled={!text.trim() && !photo}
          testID="story-publish"
        />
      </View>
    </Sheet>
  );
}
