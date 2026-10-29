import type { PetCase, Species } from "./types";

/**
 * "Círculo de vida": radio estimado de búsqueda que se amplía con el tiempo desde el
 * último avistamiento. Fórmula y tabla fijadas en PRODUCT.md (issue #10):
 *
 *   radio = min(inicial + tasa × √horas, tope)
 *
 * Decisión del 2026-10-28: todas las mascotas arrancan en 250 m alrededor del último punto y
 * llegan a 2 km en unos 30 minutos, porque en las primeras horas es cuando más se mueven y
 * cuando más sirve avisar a los vecinos. Los perfiles se conservan para poder volver a
 * diferenciar la velocidad por especie si el piloto lo muestra.
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
  dog_panic: { initial: 250, rate: 2475, cap: 2000 },
  dog_calm: { initial: 250, rate: 2475, cap: 2000 },
  cat_or_shy: { initial: 250, rate: 2475, cap: 2000 },
  unknown: { initial: 250, rate: 2475, cap: 2000 },
};

/** Radio inicial y máximo del círculo de vida de una perdida (iguales para todos los perfiles). */
export const LIFE_CIRCLE_START = 250;
export const LIFE_CIRCLE_MAX = 2000;

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

/** Momentos que la app usa para mostrar cómo crecerá el círculo: ahora, +5, +15 y +30 minutos. */
export const PREVIEW_OFFSETS_H = [0, 5 / 60, 15 / 60, 30 / 60] as const;

/** Minutos de un desplazamiento en horas, para las etiquetas ("+15 min"). */
export const offsetMinutes = (hours: number): number => Math.round(hours * 60);

/** Ventana con la que se explica cuánto crecerá el círculo enseguida. */
export const GROWTH_STEP_MIN = 5;

export type GrowthSnapshot = {
  profile: LifeCircleProfile;
  hoursElapsed: number;
  current: number;
  cap: number;
  /** Metros que sumará en los próximos GROWTH_STEP_MIN minutos (0 si ya está en el tope). */
  nextGrowth: number;
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
  const nextGrowth = Math.max(0, radiusMeters(profile, hoursElapsed + GROWTH_STEP_MIN / 60) - current);
  return {
    profile,
    hoursElapsed,
    current,
    cap,
    nextGrowth,
    pctOfCap: Math.round((current / cap) * 100),
    atCap: current >= cap,
  };
}

/** Radio que tendrá dentro de `offsetHours` (vista previa en el mapa del detalle). */
export function radiusInFuture(pet: PetCase, now: Date, offsetHours: number): number {
  if (pet.kind === "found") return currentRadius(pet, now);
  return radiusMeters(profileFor(pet), hoursBetween(pet.lastSeenAt, now) + Math.max(0, offsetHours));
}
