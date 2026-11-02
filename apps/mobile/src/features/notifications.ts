import type { AppNotification, NotificationKind, PetCase } from "@/domain/types";
import type { TKey, TParams } from "@/i18n/core";

import { petSentence } from "./petNames";

/** Suenan por el canal de alertas: alguien puede ayudar ahora mismo (igual que en la API). */
export const URGENT_KINDS = new Set<NotificationKind>(["angel_alert", "life_circle", "friend_lost", "found_nearby"]);

/**
 * Título y cuerpo de una notificación. En "¿Es Rocky?" el nombre es el de la mascota propia, no
 * el del reporte encontrado.
 */
export function notificationTexts(
  notification: Pick<AppNotification, "kind">,
  pet: PetCase,
  ownedName: string | undefined,
  t: (key: TKey, params?: TParams) => string,
): { title: string; body: string } {
  const owner = pet.ownerShortName;
  const text = (key: TKey) => (ownedName ? t(key, { name: ownedName, owner }) : petSentence(t, key, pet, { owner }));
  return { title: text(`notifications.${notification.kind}`), body: text(`notifications.body_${notification.kind}`) };
}

/** Destino al tocar una notificación (en la bandeja de la app o en la del sistema). */
export function notificationUrl(notification: Pick<AppNotification, "kind" | "petId">): string {
  return notification.kind === "angel_alert" || notification.kind === "life_circle"
    ? `/alerta/angel/${encodeURIComponent(notification.petId)}`
    : `/pet/${encodeURIComponent(notification.petId)}`;
}
