/**
 * Insignias (issue #61). Reglas acordadas con el producto:
 * - Premian ayuda real, no volumen: se calculan en el servidor a partir de hechos
 *   (reportes, avistamientos, agradecimientos de familias), nunca se compran ni se otorgan
 *   a mano, y no hay ranking público que incentive el spam.
 * - Tres niveles (bronce, plata, oro) indicados por el color del borde; "Popular" tiene cinco.
 * - Si moderación retira un reporte o la persona lo elimina, deja de contar y la insignia se
 *   recalcula sola: publicar y borrar no sube de nivel.
 *
 * Este módulo es puro para que la API pueda portar las mismas reglas.
 */

export type BadgeId =
  | "verified"
  | "reporter"
  | "rescuer"
  | "foster"
  | "eyes"
  | "quick"
  | "paw_angel"
  | "protector"
  | "reunion"
  | "spreader"
  | "community"
  | "popular";

export type BadgeCategory = "identity" | "help" | "reunions" | "community";

/** 0 = bloqueada; 1 bronce, 2 plata, 3 oro. "Popular" llega hasta 5 (leyenda). */
export type BadgeTier = 0 | 1 | 2 | 3 | 4 | 5;

export type BadgeRule = { category: BadgeCategory; thresholds: readonly number[] };

export const BADGE_RULES: Record<BadgeId, BadgeRule> = {
  verified: { category: "identity", thresholds: [1] },
  reporter: { category: "help", thresholds: [1, 5, 10] },
  rescuer: { category: "help", thresholds: [1, 3, 10] },
  foster: { category: "help", thresholds: [1, 3, 10] },
  eyes: { category: "help", thresholds: [1, 5, 20] },
  quick: { category: "help", thresholds: [1, 5, 20] },
  paw_angel: { category: "reunions", thresholds: [1, 3, 10] },
  // Un solo nivel, "leyenda", que se gana y se pierde según la calificación (rating.ts).
  protector: { category: "reunions", thresholds: [1] },
  // Un solo nivel: perder a tu mascota varias veces no es algo que se deba premiar.
  reunion: { category: "reunions", thresholds: [1] },
  spreader: { category: "community", thresholds: [1, 10, 50] },
  community: { category: "community", thresholds: [3, 10, 25] },
  popular: { category: "community", thresholds: [50, 100, 250, 500, 1000] },
};

/** Orden de presentación: identidad, ayuda directa, reencuentros, comunidad. */
export const BADGE_ORDER = Object.keys(BADGE_RULES) as BadgeId[];

/** Cuántas veces ocurrió cada hecho que cuenta para una insignia. */
export type BadgeFacts = Record<BadgeId, number>;

export type BadgeProgress = {
  id: BadgeId;
  count: number;
  tier: BadgeTier;
  maxTier: BadgeTier;
  /** Meta del siguiente nivel; null si ya está en el máximo. */
  next: number | null;
};

export function tierFor(count: number, thresholds: readonly number[]): BadgeTier {
  return thresholds.filter((min) => count >= min).length as BadgeTier;
}

export function badgeProgress(facts: BadgeFacts): BadgeProgress[] {
  return BADGE_ORDER.map((id) => {
    const { thresholds } = BADGE_RULES[id];
    const count = Math.max(0, facts[id]);
    const tier = tierFor(count, thresholds);
    return { id, count, tier, maxTier: thresholds.length as BadgeTier, next: thresholds[tier] ?? null };
  });
}

/** Niveles que subieron respecto a lo que la persona ya vio (para la celebración). */
export function newlyEarned(
  seen: Partial<Record<BadgeId, number>>,
  progress: BadgeProgress[],
): { id: BadgeId; tier: BadgeTier }[] {
  return progress.filter((p) => p.tier > (seen[p.id] ?? 0)).map(({ id, tier }) => ({ id, tier }));
}

export function tiersOf(progress: BadgeProgress[]): Partial<Record<BadgeId, number>> {
  return Object.fromEntries(progress.map((p) => [p.id, p.tier]));
}
