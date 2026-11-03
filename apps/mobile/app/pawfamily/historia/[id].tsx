import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { Screen } from "@/components/layout";
import { PawFamilyHeader } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/i18n/I18nProvider";
import { adoptionView } from "@/services/selectors";
import { useBackend, useBackendState } from "@/store/backend";

/** Colores fijos de PawFamily: la historia se ve igual en cualquier Instagram, con o sin modo oscuro. */
const STORY = { from: "#FF9A7A", to: "#D63A62", ink: "#0B2239" } as const;

/**
 * Historia 9:16 de una mascota en adopción, para Instagram o WhatsApp. Los refugios viven de que
 * sus publicaciones se compartan; la historia deja claro que adoptar es gratis.
 */
export default function AdoptionStoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const storyRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const adoption = id ? adoptionView(state, id) : undefined;

  useEffect(() => {
    if (id) void backend.loadAdoption(id).catch(() => {});
  }, [backend, id]);

  if (!adoption) {
    return (
      <Screen header={<PawFamilyHeader back />}>
        <EmptyState icon="paw-outline" title={t("pawfamily.notFound")} />
      </Screen>
    );
  }

  const owner = state.users[adoption.ownerId];
  const shelter = owner?.shelterStatus === "verified" ? owner.shelterName : undefined;
  const canvasWidth = Math.min(width - 32, 340);
  const photoSize = canvasWidth * 0.88 * 0.72;
  const facts = [t(`sex.${adoption.sex}`), t(`ageShort.${adoption.age}`), t(`size.${adoption.size}`)].join(" · ");
  const health = [
    adoption.vaccinated ? t("pawfamily.vaccinatedShort") : null,
    adoption.sterilized ? t("pawfamily.sterilizedShort") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const share = async () => {
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
      const uri = await captureRef(storyRef, { format: "png", quality: 1, result: "tmpfile", width: 1080, height: 1920 });
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: t("pawfamily.shareStory") });
      toast(t("pawfamily.storyShared"));
    } catch {
      toast(t("pawfamily.storyError"), "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen header={<PawFamilyHeader back title={t("pawfamily.storyTitle")} />} testID="adoption-story">
      <View
        ref={storyRef}
        collapsable={false}
        accessible
        accessibilityLabel={`${t("pawfamily.storyHeadline")}: ${adoption.name}. ${facts}. ${adoption.zone}`}
        style={{ width: canvasWidth, aspectRatio: 9 / 16, borderRadius: 28, overflow: "hidden" }}
        className="mt-2 self-center"
        testID="adoption-story-canvas"
      >
        <LinearGradient
          colors={[STORY.from, STORY.to]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, padding: canvasWidth * 0.06 }}
        >
          <View
            className="flex-row items-center gap-1.5 self-start rounded-full px-3 py-1"
            style={{ backgroundColor: "#FFFFFF33" }}
          >
            <Icon name="heart" size={14} color="#FFFFFF" />
            <Text variant="captionStrong" tone="white">
              PawFamily
            </Text>
          </View>

          <Text
            variant="display"
            tone="white"
            className="mt-3 text-center"
            style={{ fontSize: canvasWidth * 0.12, lineHeight: canvasWidth * 0.14 }}
          >
            {t("pawfamily.storyHeadline")}
          </Text>

          {adoption.photos[0] ? (
            <Image
              source={{ uri: adoption.photos[0] }}
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
            {adoption.name}
          </Text>
          <Text variant="bodyStrong" tone="white" className="text-center opacity-90" numberOfLines={1}>
            {facts}
          </Text>
          {health ? (
            <Text variant="captionStrong" tone="white" className="text-center" numberOfLines={1}>
              {health}
            </Text>
          ) : null}
          <Text variant="captionStrong" tone="white" className="mt-1 text-center" numberOfLines={1}>
            {shelter ? `${shelter} · ${adoption.zone}` : adoption.zone}
          </Text>

          <View className="mt-auto gap-1 rounded-2xl bg-white p-3">
            <Text variant="bodyStrong" style={{ color: STORY.to }} className="text-center">
              {t("pawfamily.storyFree")}
            </Text>
            <Text variant="caption" style={{ color: STORY.ink }} className="text-center">
              {t("pawfamily.storyCta")}
            </Text>
          </View>
        </LinearGradient>
      </View>

      <View className="mt-5 gap-3">
        <Button
          label={t("pawfamily.shareStory")}
          icon="logo-instagram"
          onPress={() => void share()}
          loading={sharing}
          testID="adoption-story-share"
        />
        <Card>
          <View className="flex-row gap-3">
            <Icon name="bulb-outline" size={20} color={STORY.to} />
            <Text variant="body" className="flex-1">
              {t("pawfamily.storyTip")}
            </Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
