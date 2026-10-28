import type { PetCase, Species } from "./types";

/**
 * "Círculo de vida": radio estimado de búsqueda que se amplía con el tiempo desde el
 * último avistamiento. Fórmula y tabla fijadas en PRODUCT.md (issue #10):
 *
 *   radio = min(inicial + tasa × √horas, tope)
 *
 * La API aplica la misma regla; ambos lados validan contra
 * packages/contracts/fixtures/life-circle.json para no desincronizarse.
 */

export type LifeCircleProfile = "dog_panic" | "dog_calm" | "cat_or_shy" | "unknown";

export type ProfileParams = {
  /** Metros al momento del avistamiento. */
  initial: number;
  /** Metros por √hora. */
  rate: number;
  /** Máximo en metros. */
  cap: number;
};

export const LIFE_CIRCLE_PROFILES: Record<LifeCircleProfile, ProfileParams> = {
  dog_panic: { initial: 1000, rate: 1200, cap: 8000 },
  dog_calm: { initial: 500, rate: 400, cap: 4000 },
  cat_or_shy: { initial: 150, rate: 60, cap: 800 },
  unknown: { initial: 300, rate: 250, cap: 5000 },
};

export type ProfileInput = {
  species: Species;
  traumaticEvent: boolean;
  shyOrIndoor: boolean;
};

/**
 * Precedencia: gato → cat_or_shy; perro con evento traumático → dog_panic (el pánico
 * domina aunque sea tímido); tímida/de interior → cat_or_shy; perro → dog_calm; resto → unknown.
 */
export function profileFor({ species, traumaticEvent, shyOrIndoor }: ProfileInput): LifeCircleProfile {
  if (species === "cat") return "cat_or_shy";
  if (species === "dog" && traumaticEvent) return "dog_panic";
  if (shyOrIndoor) return "cat_or_shy";
  if (species === "dog") return "dog_calm";
  return "unknown";
}

export function radiusMeters(profile: LifeCircleProfile, hoursElapsed: number): number {
  const { initial, rate, cap } = LIFE_CIRCLE_PROFILES[profile];
  const hours = Number.isFinite(hoursElapsed) ? Math.max(0, hoursElapsed) : 0;
  return Math.round(Math.min(initial + rate * Math.sqrt(hours), cap));
}

export function hoursBetween(fromIso: string, now: Date): number {
  return (now.getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

/** Radio vigente de un caso. Las encontradas usan el radio fijo que eligió quien reportó. */
export function currentRadius(pet: PetCase, now: Date): number {
  if (pet.kind === "found") return pet.foundSearchRadius ?? FOUND_RADIUS_OPTIONS[0];
  return radiusMeters(profileFor(pet), hoursBetween(pet.lastSeenAt, now));
}

/** Proyección para explicar cómo crece el círculo (pantalla de reporte). */
export function projection(
  profile: LifeCircleProfile,
  hours: readonly number[] = [0, 6, 24, 72],
): { hours: number; meters: number }[] {
  return hours.map((h) => ({ hours: h, meters: radiusMeters(profile, h) }));
}

/** Horas hasta alcanzar el tope (útil para mostrar "llega al máximo en ~X h"). */
export function hoursToCap(profile: LifeCircleProfile): number {
  const { initial, rate, cap } = LIFE_CIRCLE_PROFILES[profile];
  return ((cap - initial) / rate) ** 2;
}

export const FOUND_RADIUS_OPTIONS = [400, 1000, 2000, 5000] as const;

/** Momentos que la app usa para mostrar cómo crecerá el círculo. */
export const PREVIEW_OFFSETS_H = [0, 6, 24, 72] as const;

export type GrowthSnapshot = {
  profile: LifeCircleProfile;
  hoursElapsed: number;
  current: number;
  cap: number;
  /** Metros que sumará en la próxima hora (0 si ya está en el tope). */
  nextHourGrowth: number;
  /** 0–100: qué tan cerca está del radio máximo del perfil. */
  pctOfCap: number;
  atCap: boolean;
};

/** Estado de crecimiento del círculo de una perdida, para explicarlo en pantalla. */
export function growthSnapshot(
  pet: Pick<PetCase, "species" | "traumaticEvent" | "shyOrIndoor" | "lastSeenAt">,
  now: Date,
): GrowthSnapshot {
  const profile = profileFor(pet);
  const hoursElapsed = Math.max(0, hoursBetween(pet.lastSeenAt, now));
  const current = radiusMeters(profile, hoursElapsed);
  const { cap } = LIFE_CIRCLE_PROFILES[profile];
  const nextHourGrowth = Math.max(0, radiusMeters(profile, hoursElapsed + 1) - current);
  return {
    profile,
    hoursElapsed,
    current,
    cap,
    nextHourGrowth,
    pctOfCap: Math.round((current / cap) * 100),
    atCap: current >= cap,
  };
}

/** Radio que tendrá dentro de `offsetHours` (vista previa en el mapa del detalle). */
export function radiusInFuture(pet: PetCase, now: Date, offsetHours: number): number {
  if (pet.kind === "found") return currentRadius(pet, now);
  return radiusMeters(profileFor(pet), hoursBetween(pet.lastSeenAt, now) + Math.max(0, offsetHours));
}
