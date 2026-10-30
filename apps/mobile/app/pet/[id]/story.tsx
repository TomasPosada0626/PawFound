import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { petDisplayName } from "@/components/pets";
import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { SHARE_BASE_URL } from "@/config";
import { shortDate } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useBackendState } from "@/store/backend";

/** Colores fijos: la historia se ve igual en el Instagram de cualquiera, con o sin modo oscuro. */
const STORY = {
  lost: ["#E0455A", "#9E1B2E"],
  found: ["#16A088", "#0B5E50"],
  home: ["#7C5CE6", "#3F25A8"],
  ink: "#0B2239",
} as const;

/**
 * Historia para Instagram (9:16). Instagram borra las historias a las 24 horas y PawFound no
 * puede impedirlo; por eso la pantalla guía a guardarla en Destacadas (ahí queda hasta que
 * quien la publicó la quite) y, al cerrarse el caso, la API avisa a quienes la compartieron.
 * Sin teléfono ni dirección: el enlace y el QR llevan al caso.
 */
export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const storyRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const pet = state.pets.find((p) => p.id === id);

  if (!pet) {
    return (
      <Screen header={<AppHeader left={<BackButton />} title={t("story.title")} />}>
        <EmptyState icon="search-outline" title={t("pet.notFound")} />
      </Screen>
    );
  }

  const name = petDisplayName(pet, t);
  const home = pet.state === "reunited";
  const colors = home ? STORY.home : pet.kind === "lost" ? STORY.lost : STORY.found;
  const headline = home ? t("story.headlineHome") : pet.kind === "lost" ? t("story.headlineLost") : t("story.headlineFound");
  const url = `${SHARE_BASE_URL}${pet.id}`;
  const shortUrl = url.replace("https://", "");
  const canvasWidth = Math.min(width - 32, 340);
  // La foto ocupa el 78 % del ancho útil: a lo ancho completo no cabían el nombre y la zona en 9:16.
  const photoSize = canvasWidth * 0.88 * 0.78;
  const details = [pet.breed, pet.color].filter(Boolean).join(" · ");

  const copyLink = async () => {
    await Clipboard.setStringAsync(url);
    toast(t("story.copied"));
  };

  const shareStory = async () => {
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
      // Se copia el enlace antes de abrir Instagram, para pegarlo en el sticker «Enlace».
      await Clipboard.setStringAsync(url);
      const uri = await captureRef(storyRef, { format: "png", quality: 1, result: "tmpfile", width: 1080, height: 1920 });
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: t("story.share") });
      await backend.sharePet(pet.id);
      toast(t("story.shared"));
    } catch {
      toast(t("story.shareError"), "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen
      header={<AppHeader left={<BackButton fallback={`/pet/${pet.id}`} />} title={t("story.title")} />}
      testID="story-screen"
    >
      <View
        ref={storyRef}
        collapsable={false}
        accessible
        accessibilityLabel={t("story.preview", { name })}
        style={{ width: canvasWidth, aspectRatio: 9 / 16, borderRadius: 28, overflow: "hidden" }}
        className="mt-2 self-center"
        testID="story-canvas"
      >
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, padding: canvasWidth * 0.06 }}
        >
          <View
            className="flex-row items-center gap-1.5 self-start rounded-full px-3 py-1"
            style={{ backgroundColor: "#FFFFFF33" }}
          >
            <Icon name="paw" size={14} color="#FFFFFF" />
            <Text variant="captionStrong" tone="white">
              PawFound
            </Text>
          </View>

          <Text
            variant="display"
            tone="white"
            className="mt-3 text-center"
            style={{ fontSize: canvasWidth * 0.13, lineHeight: canvasWidth * 0.15 }}
          >
            {headline}
          </Text>

          {pet.photos[0] ? (
            <Image
              source={{ uri: pet.photos[0] }}
              style={{
                width: photoSize,
                height: photoSize,
                alignSelf: "center",
                borderRadius: 22,
                borderWidth: 5,
                borderColor: "#FFFFFF",
                marginTop: 12,
              }}
              contentFit="cover"
              accessible={false}
            />
          ) : (
            <View
              className="mt-3 items-center justify-center self-center rounded-3xl"
              style={{ width: photoSize, height: photoSize, backgroundColor: "#FFFFFF26" }}
            >
              <Icon name="paw" size={canvasWidth * 0.3} color="#FFFFFF" />
            </View>
          )}

          <Text variant="display" tone="white" className="mt-3 text-center" numberOfLines={1}>
            {name}
          </Text>
          {home ? (
            <Text variant="bodyStrong" tone="white" className="text-center" numberOfLines={3}>
              {t("story.homeThanks", { name })}
            </Text>
          ) : (
            <>
              {details ? (
                <Text variant="bodyStrong" tone="white" className="text-center opacity-90" numberOfLines={1}>
                  {details}
                </Text>
              ) : null}
              <Text variant="bodyStrong" tone="white" className="mt-1 text-center" numberOfLines={2}>
                {`${pet.kind === "lost" ? t("story.lastSeen", { zone: pet.zone }) : t("story.foundAt", { zone: pet.zone })} · ${shortDate(new Date(pet.lastSeenAt), locale)}`}
              </Text>
            </>
          )}

          <View className="mt-auto flex-row items-center gap-3 rounded-2xl bg-white p-2.5">
            <QrCode value={url} size={canvasWidth * 0.2} label={t("poster.qr")} />
            <View className="flex-1">
              <Text variant="captionStrong" style={{ color: STORY.ink }}>
                {t("story.cta")}
              </Text>
              <Text variant="caption" style={{ color: STORY.ink }} numberOfLines={1}>
                {shortUrl}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      <View className="mt-5 gap-3">
        <Button
          label={home ? t("story.shareHome") : t("story.share")}
          icon="logo-instagram"
          onPress={() => void shareStory()}
          loading={sharing}
          testID="story-share"
        />
        <Button
          label={t("story.copyLink")}
          icon="link-outline"
          variant="ghost"
          onPress={() => void copyLink()}
          testID="story-copy"
        />
        <Card>
          <Text variant="subheading" accessibilityRole="header" className="mb-2">
            {t("story.tipsTitle")}
          </Text>
          {(home ? [t("story.tipHome")] : [t("story.tipLink"), t("story.tipHighlights"), t("story.tipClose", { name })]).map(
            (tip, i) => (
              <View key={tip} className="mt-2 flex-row gap-3">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-primary-soft">
                  <Text variant="captionStrong" tone="primary">
                    {String(i + 1)}
                  </Text>
                </View>
                <Text variant="body" className="flex-1">
                  {tip}
                </Text>
              </View>
            ),
          )}
        </Card>
      </View>
    </Screen>
  );
}
