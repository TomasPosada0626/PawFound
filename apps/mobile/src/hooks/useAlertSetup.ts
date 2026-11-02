import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import { zoneFromPoint } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { currentPoint, startAlertLocation, syncAlertLocation, type AlertLocationMode } from "@/services/alertLocation";
import { getPushPermission, getPushToken, requestPushPermission, type PushPermission } from "@/services/pushNotifications";
import { useBackend, useBackendState } from "@/store/backend";
import { useDevicePrefs } from "@/store/devicePrefs";

/**
 * Lo que hace llegar las Alertas Ángel: permiso de notificaciones, celular registrado y ubicación.
 * Se revisa de nuevo al volver a la app: la persona puede haberlo cambiado en los ajustes de Android.
 */
export function useAlertSetup(userId: string) {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const { setLocationConsent } = useDevicePrefs();
  const [push, setPush] = useState<PushPermission | null>(null);
  const [mode, setMode] = useState<AlertLocationMode | null>(null);
  const [busy, setBusy] = useState(false);
  const zone = state.alertZones[userId];

  const refresh = useCallback(async () => {
    setPush(await getPushPermission());
    setMode(await syncAlertLocation());
  }, []);

  useEffect(() => {
    void getPushPermission().then(setPush);
    void syncAlertLocation().then(setMode);
    const sub = AppState.addEventListener("change", (status) => status === "active" && void refresh());
    return () => sub.remove();
  }, [refresh, zone]);

  /** Pide el permiso y registra el celular: sin esto la alerta no llega hasta reabrir la app. */
  const enablePush = useCallback(async () => {
    const permission = await requestPushPermission();
    setPush(permission);
    if (permission === "granted") {
      const token = await getPushToken();
      if (token) await backend.registerPushToken(token, Platform.OS === "ios" ? "ios" : "android").catch(() => {});
    }
    return permission;
  }, [backend]);

  /** Pide la ubicación y guarda el punto. false si no hubo permiso o no se pudo leer. */
  const enableLocation = useCallback(async () => {
    const next = await startAlertLocation();
    setMode(next);
    if (next === "off") return false;
    const point = await currentPoint();
    if (!point) return false;
    setLocationConsent("granted");
    const name = (await zoneFromPoint(point)) ?? t("notificationSettings.liveHere");
    await backend.setAlertZone({ location: point, zone: name });
    return true;
  }, [backend, setLocationConsent, t]);

  /** Todo de una vez, con un solo toque. */
  const activate = useCallback(async () => {
    setBusy(true);
    try {
      await enablePush();
      const prefs = backend.notificationPrefsFor(userId);
      if (!prefs.push || !prefs.angelAlerts) await backend.updateNotificationPrefs({ push: true, angelAlerts: true });
      return await enableLocation();
    } finally {
      setBusy(false);
    }
  }, [backend, enableLocation, enablePush, userId]);

  return { push, mode, zone, busy, setBusy, refresh, enablePush, enableLocation, activate };
}
