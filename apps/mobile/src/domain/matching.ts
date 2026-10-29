import { distanceMeters } from "./geo";
import type { LatLng, OwnedPet, PetCase, PetSize, Species } from "./types";

/**
 * "¿Es tu mascota?" (recomendación #4): cuando alguien reporta una mascota encontrada que se
 * parece a una de "Mis mascotas", se le pregunta a su familia. Es la gemela de
 * apps/api/internal/domain/matching.go (MatchOwned); ambas validan contra
 * packages/contracts/fixtures/owned-matches.json.
 *
 * Es deliberadamente estricta: una falsa alarma asusta a una familia cuya mascota está en casa.
 * - Misma especie, dentro de ownedMatchRadius de la zona de alertas de la familia.
 * - Tamaño igual o vecino (quien encuentra puede calcularlo mal).
 * - Sexo y color no se contradicen cuando ambos se conocen.
 * - Al menos dos señales a favor: tamaño, sexo, raza o color.
 */

const MARGIN = 500;

/**
 * Hasta dónde puede haber llegado una mascota de la especie sin que su familia lo note, más el
 * margen de la ubicación aproximada. Es independiente del círculo de vida (que llega a 2 km):
 * una coincidencia perdida cuesta más que preguntar de más. Perro 8 km, gato 800 m, otra 5 km.
 */
const MATCH_REACH: Record<Species, number> = { dog: 8000, cat: 800, other: 5000 };

export function ownedMatchRadius(species: Species): number {
  return MATCH_REACH[species] + MARGIN;
}

const SIZE_INDEX: Record<PetSize, number> = { small: 0, medium: 1, large: 2 };
const COLOR_STOP_WORDS = new Set(["con", "sin", "and", "with", "muy", "tipo", "los", "las", "del", "color"]);

const fold = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n");

/** "negra con blanco" y "Negro y blanca" comparten raíces: negr, blan. */
export function colorTokens(color: string | undefined): Set<string> {
  const tokens = new Set<string>();
  for (const word of fold(color ?? "").split(/[^\p{L}]+/u)) {
    if (word.length < 3 || COLOR_STOP_WORDS.has(word)) continue;
    tokens.add([...word].slice(0, 4).join(""));
  }
  return tokens;
}

export type OwnedMatchInput = Pick<OwnedPet, "species" | "sex" | "size" | "breed" | "color"> & { zone: LatLng };
export type FoundMatchInput = Pick<PetCase, "kind" | "state" | "species" | "sex" | "size" | "breed" | "color" | "location">;

/** Puntaje de la coincidencia, o null si no hay que avisar. */
export function matchOwned(found: FoundMatchInput, owned: OwnedMatchInput): number | null {
  if (found.kind !== "found" || found.state !== "active" || found.species !== owned.species) return null;
  const radius = ownedMatchRadius(owned.species);
  const distance = distanceMeters(owned.zone, found.location);
  if (distance > radius) return null;
  const sizeDiff = SIZE_INDEX[found.size] - SIZE_INDEX[owned.size];
  if (Math.abs(sizeDiff) > 1) return null;
  const bothSexes = found.sex !== "unknown" && owned.sex !== "unknown";
  if (bothSexes && found.sex !== owned.sex) return null;
  const foundColors = colorTokens(found.color);
  const ownedColors = colorTokens(owned.color);
  const colorOverlap = [...foundColors].some((t) => ownedColors.has(t));
  if (foundColors.size > 0 && ownedColors.size > 0 && !colorOverlap) return null;
  const breedEq = Boolean(found.breed && owned.breed && fold(found.breed) === fold(owned.breed));
  const signals: [boolean, number][] = [
    [sizeDiff === 0, 0.3],
    [bothSexes && found.sex === owned.sex, 0.2],
    [breedEq, 0.3],
    [colorOverlap, 0.3],
  ];
  const hits = signals.filter(([ok]) => ok);
  if (hits.length < 2) return null;
  return hits.reduce((score, [, weight]) => score + weight, 1 - distance / radius);
}

export type OwnedMatch = { pet: PetCase; distance: number; score: number };

/** Reportes encontrados activos que se parecen a una mascota propia, mejor puntaje primero. */
export function ownedMatches(owned: OwnedPet, zone: LatLng | undefined, candidates: PetCase[]): OwnedMatch[] {
  if (!zone) return [];
  return candidates
    .filter((p) => p.ownerId !== owned.ownerId && !p.moderationRemoved)
    .map((pet) => {
      const score = matchOwned(pet, { ...owned, zone });
      return score === null ? null : { pet, score, distance: distanceMeters(zone, pet.location) };
    })
    .filter((m): m is OwnedMatch => m !== null)
    .sort((a, b) => b.score - a.score);
}
