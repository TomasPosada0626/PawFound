import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { LogoMark, PawDecoration } from "@/components/brand";
import { AppHeader, BackButton, Screen } from "@/components/layout";
import { petDisplayName } from "@/components/pets";
import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/Button";
import { Banner, Card, EmptyState, ToggleRow } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { SHARE_BASE_URL } from "@/config";
import { formatColombianMobile, normalizeColombianMobile } from "@/domain/validation";
import { clockTime, shortDate } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

/** Colores fijos del afiche: se imprime en papel blanco, no sigue el modo oscuro. */
const POSTER = {
  lost: "#C8283D",
  found: "#0E7C6B",
  ink: "#0B2239",
  muted: "#4A5B70",
  paper: "#FFFFFF",
  soft: "#F2F6F8",
} as const;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%" }} className="px-1 pb-2.5">
      <Text variant="label" style={{ color: POSTER.muted }}>
        {label}
      </Text>
      <Text variant="captionStrong" style={{ color: POSTER.ink }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Afiche para imprimir, publicar en redes o enviar por WhatsApp (muy usado en los barrios de
 * Colombia), con todos los datos del caso. El celular solo aparece si la familia lo activa en este
 * caso, y se borra al cerrarlo. Sin él, el QR lleva al caso, donde el contacto es seguro.
 */
export default function PosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const posterRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const pet = state.pets.find((p) => p.id === id);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // Las listas no traen el celular: se pide el caso completo.
  useEffect(() => {
    if (id) void backend.loadPet(id).catch(() => {});
  }, [backend, id]);

  if (!pet) {
    return (
      <Screen header={<AppHeader left={<BackButton />} title={t("poster.title")} />}>
        <EmptyState icon="search-outline" title={t("pet.notFound")} />
      </Screen>
    );
  }

  const name = petDisplayName(pet, t);
  const lost = pet.kind === "lost";
  const accent = lost ? POSTER.lost : POSTER.found;
  const url = `${SHARE_BASE_URL}${pet.id}`;
  const isOwner = Boolean(user && user.id === pet.ownerId);
  const seenAt = new Date(pet.lastSeenAt);
  const facts: [string, string | undefined][] = [
    [t("poster.species"), t(`species.${pet.species}`)],
    [t("poster.breed"), pet.breed],
    [t("poster.sex"), pet.sex === "unknown" ? undefined : t(`sex.${pet.sex}`)],
    [t("poster.age"), pet.age === "unknown" ? undefined : t(`age.${pet.age}`)],
    [t("poster.size"), t(`size.${pet.size}`)],
    [t("poster.color"), pet.color],
    [t("poster.collar"), pet.collar],
    [t("poster.marks"), pet.marks],
  ];

  const toggleContact = async (show: boolean) => {
    const normalized = show ? normalizeColombianMobile(phone) : "";
    if (normalized === null) {
      setPhoneError(t("poster.phoneInvalid"));
      return;
    }
    setPhoneError(undefined);
    setSaving(true);
    try {
      await backend.setContactPhone(pet.id, normalized);
    } catch (e) {
      const invalid = e instanceof BackendError && e.code === "invalid_phone";
      if (invalid) setPhoneError(t("poster.phoneInvalid"));
      else toast(t("errors.unknown"), "error");
    } finally {
      setSaving(false);
    }
  };

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
            {lost ? t("poster.headlineLost") : t("poster.headlineFound")}
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
          {pet.reward ? (
            <View style={{ backgroundColor: `${accent}1A` }} className="mt-2 self-center rounded-full px-4 py-1.5">
              <Text variant="captionStrong" style={{ color: accent }}>
                {`★ ${t("poster.reward")}`}
              </Text>
            </View>
          ) : null}

          {/* Dónde y cuándo: lo primero que necesita quien la vea en la calle. */}
          <View className="mt-3 flex-row items-center gap-2 rounded-2xl p-3" style={{ backgroundColor: `${accent}12` }}>
            <Icon name="location" size={22} color={accent} />
            <View className="flex-1">
              <Text variant="label" style={{ color: POSTER.muted }}>
                {lost ? t("poster.lastSeen") : t("poster.foundAt")}
              </Text>
              <Text variant="bodyStrong" style={{ color: POSTER.ink }}>
                {pet.zone}
              </Text>
              <Text variant="caption" style={{ color: POSTER.muted }}>
                {`${shortDate(seenAt, locale)} · ${clockTime(seenAt, locale)}`}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row flex-wrap" testID="poster-facts">
            {facts.map(([label, value]) => (value ? <Fact key={label} label={label} value={value} /> : null))}
          </View>
          {pet.description ? (
            <Text variant="caption" numberOfLines={4} style={{ color: POSTER.ink }} className="px-1">
              {pet.description}
            </Text>
          ) : null}

          {pet.contactPhone ? (
            <View
              className="mt-3 flex-row items-center gap-3 rounded-2xl p-3"
              style={{ backgroundColor: accent }}
              testID="poster-phone"
            >
              <Icon name="call" size={26} color="#FFFFFF" />
              <View className="flex-1">
                <Text variant="caption" tone="white">
                  {t("poster.callFamily", { name: pet.ownerShortName })}
                </Text>
                <Text variant="heading" tone="white">
                  {formatColombianMobile(pet.contactPhone)}
                </Text>
              </View>
            </View>
          ) : (
            <Text variant="caption" className="mt-2 px-1" style={{ color: POSTER.muted }}>
              {t("poster.family", { name: pet.ownerShortName })}
            </Text>
          )}

          <View className="mt-3 flex-row items-center gap-3 rounded-2xl p-3" style={{ backgroundColor: POSTER.soft }}>
            <QrCode value={url} size={104} label={t("poster.qr")} />
            <View className="flex-1 gap-1">
              <Text variant="bodyStrong" style={{ color: POSTER.ink }}>
                {t("poster.scan")}
              </Text>
              <Text variant="caption" style={{ color: POSTER.muted }}>
                {url.replace("https://", "")}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row items-center justify-center gap-2">
            <LogoMark size={22} />
            <Text variant="captionStrong" style={{ color: POSTER.muted }}>
              PawFound
            </Text>
          </View>
        </View>
      </View>

      <View className="mt-5 gap-3">
        {isOwner && pet.state === "active" ? (
          <Card className="gap-3">
            <ToggleRow
              icon="call-outline"
              tone="primary"
              title={t("poster.phoneToggle")}
              description={t("poster.phoneHint")}
              value={Boolean(pet.contactPhone)}
              onChange={(show) => void toggleContact(show)}
              testID="poster-phone-toggle"
            />
            {pet.contactPhone ? null : (
              <TextField
                label={t("poster.phoneLabel")}
                icon="call-outline"
                value={phone}
                onChangeText={(v) => {
                  setPhone(v);
                  setPhoneError(undefined);
                }}
                keyboardType="phone-pad"
                error={phoneError}
                editable={!saving}
                testID="poster-phone-input"
              />
            )}
          </Card>
        ) : null}
        <Button
          label={t("poster.share")}
          icon="share-social"
          onPress={() => void sharePoster()}
          loading={sharing}
          testID="poster-share"
        />
        <Button
          label={t("story.open")}
          icon="logo-instagram"
          variant="outline"
          onPress={() => router.push(`/pet/${pet.id}/story`)}
          testID="poster-story"
        />
        <Banner icon="print-outline" body={t("poster.tip")} />
      </View>
    </Screen>
  );
}
