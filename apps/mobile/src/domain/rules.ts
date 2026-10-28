import { currentRadius, hoursBetween } from "./lifeCircle";
import { distanceMeters } from "./geo";
import type { CaseKind, PetCase } from "./types";

/** Límite anti-spam de PRODUCT.md: 2 publicaciones por cuenta por día (la API es la autoridad). */
export const DAILY_REPORT_LIMIT = 2;
const DAY_MS = 24 * 3_600_000;

export type PublishAllowance = { allowed: true } | { allowed: false; retryAt: Date };

/** Ventana móvil de 24 h sobre las fechas de publicación de la cuenta. */
export function publishAllowance(publishedAt: string[], now: Date, limit = DAILY_REPORT_LIMIT): PublishAllowance {
  const recent = publishedAt
    .map((iso) => new Date(iso).getTime())
    .filter((t) => now.getTime() - t < DAY_MS)
    .sort((a, b) => a - b);
  if (recent.length < limit) return { allowed: true };
  const oldestInWindow = recent[recent.length - limit] as number;
  return { allowed: false, retryAt: new Date(oldestInWindow + DAY_MS) };
}

/** Nombre fijo del grupo de caso (PRODUCT.md § Operating Context). */
export function caseGroupTitle(pet: Pick<PetCase, "kind" | "name">): { key: "lost" | "found"; name?: string } {
  return pet.kind === "lost" ? { key: "lost", name: pet.name } : { key: "found" };
}

export type Match = { pet: PetCase; distance: number; score: number };

/**
 * Posibles coincidencias para un reporte, sin IA (ARCHITECTURE.md § Fuera de alcance):
 * reportes del tipo opuesto, activos, de la misma especie, cuyo lugar cae dentro del
 * círculo de vida vigente de la perdida (más un margen) y con fechas compatibles.
 * La puntuación favorece cercanía y coincidencia de tamaño/sexo.
 */
export function findPossibleMatches(target: PetCase, candidates: PetCase[], now: Date, limit = 5): Match[] {
  const opposite: CaseKind = target.kind === "lost" ? "found" : "lost";
  const MARGIN = 500;
  return candidates
    .filter((c) => c.id !== target.id && c.kind === opposite && c.state === "active")
    .filter((c) => c.species === target.species || c.species === "other" || target.species === "other")
    .map((c) => {
      const lost = target.kind === "lost" ? target : c;
      const found = target.kind === "lost" ? c : target;
      const distance = distanceMeters(lost.location, found.location);
      const radius = currentRadius(lost, now) + MARGIN;
      const timeOk = new Date(found.lastSeenAt).getTime() >= new Date(lost.lastSeenAt).getTime() - 2 * 3_600_000;
      if (distance > radius || !timeOk) return null;
      let score = 1 - distance / radius;
      if (c.size === target.size) score += 0.3;
      if (c.sex !== "unknown" && c.sex === target.sex) score += 0.2;
      if (c.breed && target.breed && c.breed.toLowerCase() === target.breed.toLowerCase()) score += 0.3;
      return { pet: c, distance, score };
    })
    .filter((m): m is Match => m !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type ImpactStats = {
  reunited: number;
  reportsThisMonth: number;
  activeCases: number;
  /** Métrica principal del MVP (issue #9): % de perdidas reencontradas dentro de 14 días. */
  reunitedWithin14DaysPct: number;
};

/** Debajo de este volumen de casos, los porcentajes engañan: la UI muestra otro estado. */
export const MIN_CASES_FOR_STATS = 5;

/**
 * Estadísticas reales agregadas (docs/flujos/mapa-e-inicio.md): nunca números
 * inventados. Devuelve null si no hay datos suficientes para mostrarlas con honestidad.
 */
export function impactStats(pets: PetCase[], now: Date): ImpactStats | null {
  if (pets.length < MIN_CASES_FOR_STATS) return null;
  const lost = pets.filter((p) => p.kind === "lost");
  const reunited = pets.filter((p) => p.state === "reunited").length;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const reportsThisMonth = pets.filter((p) => new Date(p.createdAt).getTime() >= monthStart).length;
  const activeCases = pets.filter((p) => p.state === "active").length;
  // Solo cuentan perdidas con al menos 14 días de antigüedad o ya reencontradas, para no
  // penalizar casos que todavía están dentro de la ventana.
  const eligible = lost.filter((p) => p.state === "reunited" || hoursBetween(p.createdAt, now) >= 14 * 24);
  const fast = eligible.filter(
    (p) => p.reunitedAt && new Date(p.reunitedAt).getTime() - new Date(p.createdAt).getTime() <= 14 * DAY_MS,
  ).length;
  const reunitedWithin14DaysPct = eligible.length === 0 ? 0 : Math.round((fast / eligible.length) * 100);
  return { reunited, reportsThisMonth, activeCases, reunitedWithin14DaysPct };
}

export type ClusterItem = {
  id: string;
  latitude: number;
  longitude: number;
  pets: PetCase[];
  /** Color del cluster según mayoría (docs/flujos/mapa-e-inicio.md § Estados del mapa). */
  majority: CaseKind | "mixed";
};

/**
 * Agrupa pines por cuadrícula proporcional al zoom. `cellDivisions` controla cuántas
 * celdas caben a lo ancho de la región visible.
 */
export function clusterPets(
  pets: PetCase[],
  region: { latitudeDelta: number; longitudeDelta: number },
  cellDivisions = 7,
): ClusterItem[] {
  const latCell = region.latitudeDelta / cellDivisions;
  const lngCell = region.longitudeDelta / cellDivisions;
  const buckets = new Map<string, PetCase[]>();
  for (const pet of pets) {
    const key = `${Math.floor(pet.location.latitude / latCell)}:${Math.floor(pet.location.longitude / lngCell)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), pet]);
  }
  return [...buckets.entries()].map(([key, group]) => {
    const lostCount = group.filter((p) => p.kind === "lost").length;
    const foundCount = group.length - lostCount;
    return {
      id: group.length === 1 ? (group[0] as PetCase).id : `cluster:${key}`,
      latitude: group.reduce((s, p) => s + p.location.latitude, 0) / group.length,
      longitude: group.reduce((s, p) => s + p.location.longitude, 0) / group.length,
      pets: group,
      majority: lostCount > foundCount ? "lost" : foundCount > lostCount ? "found" : "mixed",
    };
  });
}
