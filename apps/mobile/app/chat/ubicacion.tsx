import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PetMap } from "@/components/map/PetMap";
import { Button } from "@/components/ui/Button";
import { Banner, EmptyState } from "@/components/ui/Controls";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { regionForRadius, type Region } from "@/domain/geo";
import { shortName } from "@/domain/privacy";
import type { LatLng } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { LOCATION_LABEL_MAX } from "@/services/mockBackend";
import { counterpart } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useUserLocation } from "@/store/location";

type Mode = "current" | "meeting";

/**
 * Compartir ubicación en un mensaje directo (nunca en grupos): la ubicación actual o un punto
 * de encuentro elegido en el mapa, que también puede ser la ubicación actual. No es en vivo: se
 * envía el punto una vez, y quien lo compartió lo puede quitar cuando quiera.
 */
export default function ShareLocationScreen() {
  const { thread: threadId } = useLocalSearchParams<{ thread: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const { location, request } = useUserLocation();
  const [mode, setMode] = useState<Mode>("current");
  const [current, setCurrent] = useState<LatLng | null>(null);
  const [meeting, setMeeting] = useState<LatLng | null>(null);
  const [region, setRegion] = useState<Region>(() => regionForRadius(location, 300));
  const [locating, setLocating] = useState(true);
  const [denied, setDenied] = useState(false);
  const [label, setLabel] = useState("");
  const [sending, setSending] = useState(false);

  const applyPoint = useCallback((point: LatLng | null) => {
    setLocating(false);
    setDenied(!point);
    if (!point) return;
    setCurrent(point);
    setRegion(regionForRadius(point, 300));
  }, []);

  const locate = async () => {
    setLocating(true);
    const point = await request();
    applyPoint(point);
    return point;
  };

  // Al abrir se pide la ubicación del celular (la persona tocó "Compartir ubicación").
  useEffect(() => {
    let alive = true;
    void request().then((point) => alive && applyPoint(point));
    return () => {
      alive = false;
    };
  }, [request, applyPoint]);

  const thread = state.threads.find((th) => th.id === threadId);
  if (!user) return <Redirect href="/auth/login" />;
  if (!thread || thread.kind !== "dm" || thread.archived || !thread.memberIds.includes(user.id)) {
    return (
      <Screen header={<AppHeader left={<BackButton fallback="/messages" />} />}>
        <EmptyState icon="chatbubbles-outline" title={t("chat.notFound")} />
      </Screen>
    );
  }
  const other = counterpart(state, thread, user.id);
  const name = other ? shortName(other.name) : t("common.deletedUser");
  const point = mode === "current" ? current : meeting;

  const pickMine = async () => {
    const mine = current ?? (await locate());
    if (!mine) return;
    setMeeting(mine);
    setRegion(regionForRadius(mine, 300));
  };

  const send = async () => {
    if (!point) return;
    setSending(true);
    try {
      await backend.shareLocation(
        thread.id,
        mode === "current"
          ? { kind: "current", location: point }
          : { kind: "meeting", location: point, label: label.trim() || undefined },
        locale,
      );
      router.back();
    } catch (error) {
      const code = error instanceof BackendError ? error.code : "unknown";
      toast(code === "rate_limited" ? t("chat.rateLimited") : t("errors.unknown"), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen testID="share-location" header={<AppHeader left={<BackButton fallback={`/chat/${thread.id}`} />} />}>
      <Text variant="title" className="mt-1" accessibilityRole="header">
        {t("chatLocation.title")}
      </Text>
      <Text variant="body" tone="muted" className="mb-4">
        {t("chatLocation.onlyName", { name })}
      </Text>

      <SegmentedControl
        items={[
          { key: "current", label: t("chatLocation.tabCurrent"), icon: "person" },
          { key: "meeting", label: t("chatLocation.tabMeeting"), icon: "flag" },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          if (next === "meeting" && !meeting && current) setMeeting(current);
        }}
      />

      <View className="mt-4 overflow-hidden rounded-3xl">
        <PetMap
          height={300}
          region={region}
          showsUserLocation={Boolean(current)}
          shareMarker={point ? { coordinate: point, kind: mode } : undefined}
          onMapPress={mode === "meeting" ? setMeeting : undefined}
          testID="share-location-map"
        />
      </View>
      <Text variant="caption" className="mt-2">
        {mode === "current" ? t("chatLocation.currentHint") : t("chatLocation.meetingHint")}
      </Text>

      {mode === "current" && denied ? (
        <View className="mt-3">
          <Banner
            tone="warning"
            icon="location-outline"
            body={t("chatLocation.permission")}
            action={<Button label={t("common.retry")} variant="ghost" compact onPress={() => void locate()} />}
          />
        </View>
      ) : null}

      {mode === "meeting" ? (
        <View className="mt-4 gap-3">
          <TextField
            label={t("chatLocation.label")}
            icon="flag-outline"
            placeholderText={t("chatLocation.labelPlaceholder")}
            value={label}
            onChangeText={setLabel}
            maxLength={LOCATION_LABEL_MAX}
            testID="share-location-label"
          />
          <Button
            label={t("chatLocation.useMine")}
            icon="locate"
            variant="outline"
            compact
            onPress={() => void pickMine()}
            testID="share-location-use-mine"
          />
        </View>
      ) : null}

      <View className="mt-4">
        <Banner icon="shield-checkmark-outline" body={t("chatLocation.privacy")} />
      </View>

      <Button
        label={mode === "current" ? t("chatLocation.sendCurrent", { name }) : t("chatLocation.sendMeeting")}
        icon="send"
        className="mt-4"
        loading={sending || (mode === "current" && locating)}
        disabled={!point}
        onPress={() => void send()}
        testID="share-location-send"
      />
    </Screen>
  );
}
