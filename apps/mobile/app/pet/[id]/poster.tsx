import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { LogoMark, PawDecoration } from "@/components/brand";
import { AppHeader, BackButton, Screen } from "@/components/layout";
import { petDisplayName } from "@/components/pets";
import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/Button";
import { Banner, EmptyState } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { SHARE_BASE_URL } from "@/config";
import { shortDate } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useBackendState } from "@/store/backend";

/** Colores fijos del afiche: se imprime en papel blanco, no sigue el modo oscuro. */
const POSTER = { lost: "#C8283D", found: "#0E7C6B", ink: "#0B2239", muted: "#4A5B70", paper: "#FFFFFF" } as const;

/**
 * Afiche para imprimir o compartir por WhatsApp (muy usado en los barrios de Colombia).
 * Sin teléfono ni dirección: el QR lleva al caso, donde el contacto es seguro.
 */
export default function PosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const toast = useToast();
  const posterRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const pet = state.pets.find((p) => p.id === id);

  if (!pet) {
    return (
      <Screen header={<AppHeader left={<BackButton />} title={t("poster.title")} />}>
        <EmptyState icon="search-outline" title={t("pet.notFound")} />
      </Screen>
    );
  }

  const name = petDisplayName(pet, t);
  const accent = pet.kind === "lost" ? POSTER.lost : POSTER.found;
  const url = `${SHARE_BASE_URL}${pet.id}`;
  const details = [pet.breed, pet.color, t(`size.${pet.size}`)].filter(Boolean).join(" · ");

  const sharePoster = async () => {
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
      const uri = await captureRef(posterRef, { format: "png", quality: 1, result: "tmpfile" });
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: t("poster.share") });
      await backend.sharePet(pet.id);
      toast(t("poster.shared"));
    } catch {
      toast(t("poster.shareError"), "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen
      header={<AppHeader left={<BackButton fallback={`/pet/${pet.id}`} />} title={t("poster.title")} />}
      testID="poster-screen"
    >
      <View
        ref={posterRef}
        collapsable={false}
        accessible
        accessibilityLabel={t("poster.preview", { name })}
        style={{ backgroundColor: POSTER.paper, borderRadius: 24, overflow: "hidden" }}
        className="mt-2 w-full max-w-[420px] self-center border border-border"
      >
        <View style={{ backgroundColor: accent }} className="items-center px-5 pb-4 pt-5">
          <PawDecoration size={90} opacity={0.18} className="absolute -left-4 -top-3" />
          <PawDecoration size={70} opacity={0.14} className="absolute -right-2 bottom-0" />
          <Text variant="display" tone="white" className="text-center text-[40px] leading-[46px]">
            {pet.kind === "lost" ? t("poster.headlineLost") : t("poster.headlineFound")}
          </Text>
        </View>

        <View className="p-5">
          {pet.photos[0] ? (
            <Image
              source={{ uri: pet.photos[0] }}
              style={{ width: "100%", aspectRatio: 1, borderRadius: 18 }}
              contentFit="cover"
              accessible={false}
            />
          ) : null}

          <Text variant="display" className="mt-4 text-center" style={{ color: POSTER.ink }}>
            {name}
          </Text>
          {details ? (
            <Text variant="subheading" className="text-center" style={{ color: POSTER.muted }}>
              {details}
            </Text>
          ) : null}

          <View className="mt-3 gap-1">
            <Text variant="bodyStrong" className="text-center" style={{ color: POSTER.ink }}>
              {`${pet.kind === "lost" ? t("poster.lastSeen") : t("poster.foundAt")}: ${pet.zone}`}
            </Text>
            <Text variant="body" className="text-center" style={{ color: POSTER.muted }}>
              {shortDate(new Date(pet.lastSeenAt), locale)}
            </Text>
            {pet.collar || pet.marks ? (
              <Text variant="body" className="text-center" style={{ color: POSTER.muted }}>
                {[pet.collar, pet.marks].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
          </View>

          {pet.reward ? (
            <View style={{ backgroundColor: `${accent}1A` }} className="mt-3 self-center rounded-full px-4 py-1.5">
              <Text variant="captionStrong" style={{ color: accent }}>
                {`★ ${t("poster.reward")}`}
              </Text>
            </View>
          ) : null}

          <View className="mt-5 flex-row items-center gap-4 rounded-2xl p-3" style={{ backgroundColor: "#F2F6F8" }}>
            <QrCode value={url} size={112} label={t("poster.qr")} />
            <View className="flex-1 gap-1">
              <Text variant="bodyStrong" style={{ color: POSTER.ink }}>
                {t("poster.scan")}
              </Text>
              <Text variant="caption" style={{ color: POSTER.muted }}>
                {url.replace("https://", "")}
              </Text>
            </View>
          </View>

          <View className="mt-4 flex-row items-center justify-center gap-2">
            <LogoMark size={22} />
            <Text variant="caption" style={{ color: POSTER.muted }} className="shrink">
              {t("poster.privacy")}
            </Text>
          </View>
        </View>
      </View>

      <View className="mt-5 gap-3">
        <Button
          label={t("poster.share")}
          icon="share-social"
          onPress={() => void sharePoster()}
          loading={sharing}
          testID="poster-share"
        />
        <Banner icon="print-outline" body={t("poster.tip")} />
      </View>
    </Screen>
  );
}
