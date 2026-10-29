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

/** A menos de esta distancia del reporte llega de inmediato, aunque el círculo sea menor. */
export const ALERT_MIN_RADIUS = 250;

/** Una ubicación sin actualizar en este tiempo deja de usarse (no se avisa por un lugar viejo). */
export const ALERT_LOCATION_TTL_H = 24;

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
  // Alcance: donde está cada persona ahora (su última ubicación), no una zona fija.
  const radius = Math.max(ALERT_MIN_RADIUS, currentRadius(pet, now));
  const freshSince = now.getTime() - ALERT_LOCATION_TTL_H * 3_600_000;
  return candidates
    .filter((c) => c.userId !== pet.ownerId && c.prefs.angelAlerts && !c.alreadyAlerted && c.alertsLast24h < MAX_ALERTS_PER_DAY)
    .filter((c) => !c.zone.updatedAt || new Date(c.zone.updatedAt).getTime() >= freshSince)
    .filter((c) => distanceMeters(c.zone.location, pet.location) <= radius)
    .map((c) => c.userId);
}

/** Por qué una cuenta no recibiría Alertas Ángel, en el orden en que conviene resolverlo. */
export type AlertsGap = "permission" | "push" | "angel" | "zone";

export function alertsGap(
  permission: "granted" | "denied" | "undetermined",
  prefs: Pick<NotificationPrefs, "push" | "angelAlerts">,
  hasZone: boolean,
): AlertsGap | null {
  if (permission !== "granted") return "permission";
  if (!prefs.push) return "push";
  if (!prefs.angelAlerts) return "angel";
  if (!hasZone) return "zone";
  return null;
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
