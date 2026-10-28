import { distanceMeters } from "./geo";
import { currentRadius } from "./lifeCircle";
import type { AlertZone, NotificationPrefs, PetCase } from "./types";

/**
 * Alerta Ángel (issue #45): notificación push de la app, no SMS (cero costo por mensaje, la
 * persona la controla desde sus ajustes). Funciona igual en Android y, más adelante, iOS.
 *
 * El alcance lo decide el círculo de vida: al publicarse una mascota perdida reciben la
 * alerta los celulares cuya zona queda dentro del círculo inicial, y a medida que el círculo
 * crece la reciben los que van quedando dentro. Reglas:
 * - Solo recibe quien activó las alertas y guardó una zona (consentimiento explícito).
 * - Una sola alerta por persona y caso.
 * - Nunca más de MAX_ALERTS_PER_DAY alertas por persona en 24 h, para no saturar.
 */

export const MAX_ALERTS_PER_DAY = 5;

export type AlertCandidate = {
  userId: string;
  zone: AlertZone;
  prefs: Pick<NotificationPrefs, "angelAlerts">;
  /** Alertas recibidas en las últimas 24 h. */
  alertsLast24h: number;
  /** Ya recibió una alerta por este caso. */
  alreadyAlerted: boolean;
};

/** Quién debe recibir la Alerta Ángel de este caso ahora: su zona quedó dentro del círculo. */
export function alertAudience(pet: PetCase, candidates: AlertCandidate[], now: Date): string[] {
  if (pet.kind !== "lost" || pet.state !== "active") return [];
  const radius = currentRadius(pet, now);
  return candidates
    .filter((c) => c.userId !== pet.ownerId && c.prefs.angelAlerts && !c.alreadyAlerted && c.alertsLast24h < MAX_ALERTS_PER_DAY)
    .filter((c) => distanceMeters(c.zone.location, pet.location) <= radius)
    .map((c) => c.userId);
}

const minutesOf = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Modo descanso: la alerta llega a la bandeja, pero el celular no suena. Soporta rangos nocturnos. */
export function isQuietTime(prefs: Pick<NotificationPrefs, "quietHours" | "quietFrom" | "quietTo">, now: Date): boolean {
  if (!prefs.quietHours) return false;
  const from = minutesOf(prefs.quietFrom);
  const to = minutesOf(prefs.quietTo);
  const current = now.getHours() * 60 + now.getMinutes();
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}
