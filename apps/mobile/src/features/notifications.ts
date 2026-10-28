import type { AppNotification } from "@/domain/types";

/** Destino al tocar una notificación (en la bandeja de la app o en la del sistema). */
export function notificationUrl(notification: Pick<AppNotification, "kind" | "petId">): string {
  return notification.kind === "angel_alert" || notification.kind === "life_circle"
    ? `/alerta/angel/${encodeURIComponent(notification.petId)}`
    : `/pet/${encodeURIComponent(notification.petId)}`;
}
