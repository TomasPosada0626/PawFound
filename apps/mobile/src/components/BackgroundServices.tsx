import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { isQuietTime } from "@/domain/alerts";
import { notificationUrl } from "@/features/notifications";
import { useI18n } from "@/i18n/I18nProvider";
import { CHANNELS, configurePush, getPushPermission, presentLocal, safeNotificationUrl } from "@/services/pushNotifications";
import { useBackend, useBackendState } from "@/store/backend";

import { petDisplayName } from "./pets";

const JOBS_INTERVAL_MS = 60_000;

/**
 * Servicios sin interfaz: tareas periódicas del servidor simulado (círculo de vida) y
 * entrega de notificaciones al sistema, más el enlace al tocarlas.
 */
export function BackgroundServices() {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const userId = state.sessionUserId;
  const shown = useRef<{ userId: string; ids: Set<string> } | null>(null);

  // Canales de Android con nombres traducidos.
  useEffect(() => {
    void configurePush({ angel: t("push.channelAngel"), updates: t("push.channelUpdates") });
  }, [t]);

  // Tocar una notificación abre su pantalla, también si la app estaba cerrada.
  useEffect(() => {
    let alive = true;
    const open = (data: unknown) => {
      const url = safeNotificationUrl(data);
      if (url) router.push(url as never);
    };
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (alive && response) open(response.notification.request.content.data);
      })
      .catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  // Tareas del servidor: al abrir, al volver a la app y cada minuto.
  useEffect(() => {
    backend.runScheduledJobs();
    const timer = setInterval(() => backend.runScheduledJobs(), JOBS_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") backend.runScheduledJobs();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [backend]);

  // Notificaciones nuevas de la cuenta actual → sistema (si hay permiso y push activo).
  useEffect(() => {
    if (!userId) return;
    const mine = state.notifications.filter((n) => n.userId === userId);
    if (shown.current?.userId !== userId) {
      // Lo que ya existía al abrir la app (o al entrar a la cuenta) no se vuelve a mostrar.
      shown.current = { userId, ids: new Set(mine.map((n) => n.id)) };
      return;
    }
    const seen = shown.current.ids;
    const fresh = mine.filter((n) => !seen.has(n.id) && !n.read);
    if (!fresh.length) return;
    fresh.forEach((n) => seen.add(n.id));
    const prefs = backend.notificationPrefsFor(userId);
    if (!prefs.push) return;
    void getPushPermission().then((permission) => {
      if (permission !== "granted") return;
      const silent = isQuietTime(prefs, new Date());
      for (const n of fresh) {
        const pet = state.pets.find((p) => p.id === n.petId);
        if (!pet) continue;
        const owned = n.ownedPetId ? state.ownedPets.find((p) => p.id === n.ownedPetId) : undefined;
        const name = owned?.name ?? petDisplayName(pet, t);
        void presentLocal({
          title: t(`notifications.${n.kind}`, { name }),
          body: t(`notifications.body_${n.kind}`, { name }),
          url: notificationUrl(n),
          channel: n.kind === "angel_alert" || n.kind === "life_circle" ? CHANNELS.angel : CHANNELS.updates,
          silent,
        });
      }
    });
  }, [backend, state.notifications, state.ownedPets, state.pets, t, userId]);

  return null;
}
