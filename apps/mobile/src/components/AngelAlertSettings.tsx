import { useEffect, useState } from "react";
import { Linking, View } from "react-native";

import { MAX_ALERTS_PER_DAY } from "@/domain/alerts";
import type { NotificationPrefs } from "@/domain/types";
import { usePlacePicker } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { getPushPermission, requestPushPermission, type PushPermission } from "@/services/pushNotifications";
import { useBackend, useBackendState } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";

import { SettingsCard } from "./SettingsLayout";
import { Button } from "./ui/Button";
import { Banner, Divider, ToggleRow } from "./ui/Controls";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

/**
 * Ajustes de la Alerta Ángel: permiso del sistema, interruptor y zona aproximada. El alcance
 * lo decide el círculo de vida de cada caso. Sin zona no hay alertas: guardarla es el
 * consentimiento explícito (issue #45).
 */
export function AngelAlertSettings({ prefs, userId }: { prefs: NotificationPrefs; userId: string }) {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const toast = useToast();
  const pickPlace = usePlacePicker();
  const { setLocationConsent } = useDevicePrefs();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [locating, setLocating] = useState(false);
  const zone = state.alertZones[userId];

  useEffect(() => {
    let alive = true;
    void getPushPermission().then((p) => alive && setPermission(p));
    return () => {
      alive = false;
    };
  }, []);

  const saveZone = async () => {
    setLocating(true);
    const place = await pickPlace();
    setLocating(false);
    if (!place) {
      toast(t("notificationSettings.zoneError"), "error");
      return;
    }
    setLocationConsent("granted");
    const name = place.zone ?? t("report.zoneUnknown");
    await backend.setAlertZone({ location: place.point, zone: name });
    toast(t("notificationSettings.zoneSaved", { zone: name }));
  };

  const removeZone = async () => {
    await backend.setAlertZone(null);
    toast(t("notificationSettings.zoneRemoved"), "info");
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
        <Text variant="bodyStrong">{t("notificationSettings.zone")}</Text>
        <Text variant="caption" testID="alert-zone-label">
          {zone ? zone.zone : t("notificationSettings.zoneNone")}
        </Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Button
            compact
            variant={zone ? "outline" : "primary"}
            icon="locate"
            label={zone ? t("notificationSettings.zoneUpdate") : t("notificationSettings.zoneSet")}
            onPress={() => void saveZone()}
            loading={locating}
            testID="alert-zone-set"
          />
          {zone ? (
            <Button
              compact
              variant="ghost"
              icon="close-circle-outline"
              label={t("notificationSettings.zoneRemove")}
              onPress={() => void removeZone()}
              testID="alert-zone-remove"
            />
          ) : null}
        </View>
        <Text variant="caption">{t("notificationSettings.zonePrivacy")}</Text>
      </View>
    </SettingsCard>
  );
}
