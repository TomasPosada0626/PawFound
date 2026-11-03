/**
 * Calificación por ayudar en un caso (mismas reglas que apps/api/internal/domain/rules.go). El
 * promedio solo se muestra desde RATING_VISIBLE_FROM calificaciones reales (antes, una sola nota lo
 * movería demasiado) y cuenta las RATING_WINDOW más recientes. No hay calificaciones de relleno.
 */
export const RATING_WINDOW = 20;
/** Estrellas de una calificación: de 1 a 5. Al agradecer, la hoja propone 5. */
export const RATING_MAX_STARS = 5;
/** Calificaciones reales que hacen falta para ver el promedio. */
export const RATING_VISIBLE_FROM = 10;
/** Calificaciones reales que hacen falta para "Protector animal". */
export const PROTECTOR_MIN_RATINGS = 10;

/** Promedio de las más recientes (`stars` va de la más reciente a la más antigua); 0 si aún no se muestra. */
export function ratingAverage(stars: readonly number[]): number {
  const recent = stars.slice(0, RATING_WINDOW);
  if (recent.length < RATING_VISIBLE_FROM) return 0;
  return recent.reduce((sum, s) => sum + s, 0) / recent.length;
}

/** "Protector animal": desde la décima calificación real, un promedio de más de 4,5. */
export function isAnimalProtector(stars: readonly number[]): boolean {
  const recent = stars.slice(0, RATING_WINDOW);
  const sum = recent.reduce((total, s) => total + s, 0);
  return recent.length >= PROTECTOR_MIN_RATINGS && sum * 2 > recent.length * 9;
}

/** "4,8" o "4,75": dos decimales cuando hacen falta. */
export function formatRating(value: number, locale: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
