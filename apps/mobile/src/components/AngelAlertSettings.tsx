import { useEffect, useState } from "react";
import { Linking, View } from "react-native";

import { relativeTime } from "@/i18n/format";
import {
  alertLocationMode,
  currentPoint,
  startAlertLocation,
  stopAlertLocation,
  type AlertLocationMode,
} from "@/services/alertLocation";

import { MAX_ALERTS_PER_DAY } from "@/domain/alerts";
import type { NotificationPrefs } from "@/domain/types";
import { zoneFromPoint } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { getPushPermission, requestPushPermission, type PushPermission } from "@/services/pushNotifications";
import { useBackend, useBackendState } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";

import { SettingsCard } from "./SettingsLayout";
import { Button } from "./ui/Button";
import { Banner, Divider, ToggleRow } from "./ui/Controls";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

/**
 * Ajustes de la Alerta Ángel: permiso del sistema, interruptor y zona aproximada. El alcance
 * lo decide el círculo de vida de cada caso. Sin zona no hay alertas: guardarla es el
 * consentimiento explícito (issue #45).
 */
export function AngelAlertSettings({ prefs, userId }: { prefs: NotificationPrefs; userId: string }) {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const toast = useToast();
  const { setLocationConsent } = useDevicePrefs();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [locating, setLocating] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [mode, setMode] = useState<AlertLocationMode | null>(null);
  const zone = state.alertZones[userId];

  useEffect(() => {
    let alive = true;
    void alertLocationMode().then((m) => alive && setMode(m));
    return () => {
      alive = false;
    };
  }, [zone]);

  useEffect(() => {
    let alive = true;
    void getPushPermission().then((p) => alive && setPermission(p));
    return () => {
      alive = false;
    };
  }, []);

  // Después del aviso (Google Play exige explicar la ubicación en segundo plano antes de pedirla).
  const enableLive = async () => {
    setDisclosure(false);
    setLocating(true);
    const next = await startAlertLocation();
    setMode(next);
    if (next === "off") {
      setLocating(false);
      toast(t("notificationSettings.zoneError"), "error");
      return;
    }
    const point = await currentPoint();
    if (!point) {
      setLocating(false);
      toast(t("notificationSettings.zoneError"), "error");
      return;
    }
    setLocationConsent("granted");
    const name = (await zoneFromPoint(point)) ?? t("notificationSettings.liveHere");
    await backend.setAlertZone({ location: point, zone: name });
    setLocating(false);
    toast(next === "always" ? t("notificationSettings.liveEnabled") : t("notificationSettings.liveForegroundHint"));
  };

  const disableLive = async () => {
    await stopAlertLocation();
    await backend.setAlertZone(null);
    setMode(await alertLocationMode());
    toast(t("notificationSettings.liveDisabled"), "info");
  };

  return (
    <SettingsCard title={t("notificationSettings.angelTitle")} subtitle={t("notificationSettings.angelSubtitle")}>
      {permission && permission !== "granted" ? (
        <View className="mb-3">
          <Banner
            tone="warning"
            icon="notifications-off-outline"
            title={t("notificationSettings.permissionTitle")}
            body={permission === "denied" ? t("notificationSettings.permissionDenied") : t("notificationSettings.permissionBody")}
            action={
              <Button
                compact
                variant="soft"
                label={permission === "denied" ? t("notificationSettings.openSettings") : t("notificationSettings.permissionCta")}
                onPress={async () => {
                  if (permission === "denied") void Linking.openSettings();
                  else setPermission(await requestPushPermission());
                }}
                testID="push-permission"
              />
            }
          />
        </View>
      ) : null}

      <ToggleRow
        icon="paw"
        tone="violet"
        title={t("notificationSettings.angelAlerts")}
        description={t("notificationSettings.angelAlertsDesc", { count: MAX_ALERTS_PER_DAY })}
        value={prefs.angelAlerts}
        onChange={(v) => void backend.updateNotificationPrefs({ angelAlerts: v })}
        testID="pref-angel"
      />
      <Divider />

      <View className="gap-2 py-2">
        <Text variant="bodyStrong">{t("notificationSettings.liveTitle")}</Text>
        <Text variant="caption">{t("notificationSettings.liveDesc")}</Text>
        {zone ? (
          <View className="mt-1 gap-1 rounded-2xl bg-primary-soft p-3" testID="alert-zone-label">
            <Text variant="bodyStrong" tone="primary">
              {t("notificationSettings.liveOn", { zone: zone.zone })}
            </Text>
            {zone.updatedAt ? (
              <Text variant="caption">
                {t("notificationSettings.liveUpdated", { time: relativeTime(zone.updatedAt, new Date(), locale).toLowerCase() })}
              </Text>
            ) : null}
            <Text variant="caption">
              {mode === "always" ? t("notificationSettings.liveModeAlways") : t("notificationSettings.liveModeForeground")}
            </Text>
          </View>
        ) : null}
        {zone && mode !== "always" ? (
          <Banner
            tone="warning"
            icon="location-outline"
            body={t("notificationSettings.liveForegroundHint")}
            action={
              <Button
                compact
                variant="soft"
                label={t("notificationSettings.openSettings")}
                onPress={() => void Linking.openSettings()}
                testID="alert-location-settings"
              />
            }
          />
        ) : null}
        <View className="mt-2 flex-row flex-wrap gap-2">
          {zone ? (
            <Button
              compact
              variant="ghost"
              icon="close-circle-outline"
              label={t("notificationSettings.liveDisable")}
              onPress={() => void disableLive()}
              testID="alert-zone-remove"
            />
          ) : (
            <Button
              compact
              icon="navigate"
              label={t("notificationSettings.liveEnable")}
              onPress={() => setDisclosure(true)}
              loading={locating}
              testID="alert-zone-set"
            />
          )}
        </View>
        <Text variant="caption">{t("notificationSettings.livePrivacy")}</Text>
      </View>
      <Sheet
        visible={disclosure}
        onClose={() => setDisclosure(false)}
        title={t("notificationSettings.disclosureTitle")}
        testID="location-disclosure"
      >
        <Text variant="body" className="mb-5">
          {t("notificationSettings.disclosureBody")}
        </Text>
        <View className="gap-3 pb-2">
          <Button
            label={t("notificationSettings.disclosureContinue")}
            onPress={() => void enableLive()}
            testID="disclosure-continue"
          />
          <Button label={t("notificationSettings.disclosureCancel")} variant="ghost" onPress={() => setDisclosure(false)} />
        </View>
      </Sheet>
    </SettingsCard>
  );
}
