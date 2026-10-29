import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { alertsGap, type AlertsGap } from "@/domain/alerts";
import { useI18n } from "@/i18n/I18nProvider";
import { getPushPermission, type PushPermission } from "@/services/pushNotifications";
import { useBackend, useBackendState } from "@/store/backend";

import { Button } from "./ui/Button";
import { Banner } from "./ui/Controls";

/**
 * Qué le falta a la cuenta para recibir Alertas Ángel, o null si nada. Vuelve a leer el
 * permiso del celular al regresar a la app (la persona pudo cambiarlo en los ajustes).
 * `undefined` mientras se consulta el permiso.
 */
export function useAlertsGap(userId: string): AlertsGap | null | undefined {
  const backend = useBackend();
  const state = useBackendState();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void getPushPermission().then((p) => alive && setPermission(p));
    refresh();
    const sub = AppState.addEventListener("change", (status) => status === "active" && refresh());
    return () => {
      alive = false;
      sub.remove();
    };
  }, [state.notificationPrefs]);
  if (permission === null) return undefined;
  return alertsGap(permission, backend.notificationPrefsFor(userId), Boolean(state.alertZones[userId]));
}

/**
 * Letrero cuando las alertas no pueden llegar. Las notificaciones se pueden desactivar
 * (Apple y Android exigen que sea opcional), pero la persona debe saber qué pierde.
 */
export function AlertsOffBanner({ userId, showAction = true }: { userId: string; showAction?: boolean }) {
  const { t } = useI18n();
  const gap = useAlertsGap(userId);
  if (!gap) return null;
  return (
    <Banner
      tone="warning"
      icon="notifications-off-outline"
      title={t("alertsOff.title")}
      body={t(`alertsOff.${gap}`)}
      action={
        showAction ? (
          <Button
            label={t("alertsOff.cta")}
            icon="notifications-outline"
            variant="outline"
            compact
            onPress={() => router.push("/settings/notifications")}
            testID="alerts-off-cta"
          />
        ) : undefined
      }
    />
  );
}
