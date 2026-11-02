/**
 * Calificación por ayudar en un caso (mismas reglas que apps/api/internal/domain/rules.go).
 * Toda cuenta empieza con 20 calificaciones de 5 estrellas y cada una real va reemplazando a una
 * de ellas: una mala nota no hunde a quien recién empieza y solo cuentan las 20 más recientes.
 */
export const RATING_WINDOW = 20;
export const RATING_START = 5;
/** Calificaciones reales que hacen falta para "Protector animal". */
export const PROTECTOR_MIN_RATINGS = 10;

function ratingSum(stars: readonly number[]): number {
  const recent = stars.slice(0, RATING_WINDOW);
  return recent.reduce((sum, s) => sum + s, (RATING_WINDOW - recent.length) * RATING_START);
}

/** Promedio vigente; `stars` va de la más reciente a la más antigua. */
export function ratingAverage(stars: readonly number[]): number {
  return ratingSum(stars) / RATING_WINDOW;
}

/** "Protector animal": desde la décima calificación real, sin las 5 estrellas iniciales, más de 4,5. */
export function isAnimalProtector(stars: readonly number[]): boolean {
  const recent = stars.slice(0, RATING_WINDOW);
  const sum = recent.reduce((total, s) => total + s, 0);
  return recent.length >= PROTECTOR_MIN_RATINGS && sum * 2 > recent.length * 9;
}

/** "4,8" o "4,75": dos decimales cuando hacen falta. */
export function formatRating(value: number, locale: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
