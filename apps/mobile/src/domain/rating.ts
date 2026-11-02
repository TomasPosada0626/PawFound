/**
 * Calificación por ayudar en un caso (mismas reglas que apps/api/internal/domain/rules.go).
 * Toda cuenta empieza con 20 calificaciones de 5 estrellas y cada una real va reemplazando a una
 * de ellas: una mala nota no hunde a quien recién empieza y solo cuentan las 20 más recientes.
 */
export const RATING_WINDOW = 20;
export const RATING_START = 5;
function ratingSum(stars: readonly number[]): number {
  const recent = stars.slice(0, RATING_WINDOW);
  return recent.reduce((sum, s) => sum + s, (RATING_WINDOW - recent.length) * RATING_START);
}

/** Promedio vigente; `stars` va de la más reciente a la más antigua. */
export function ratingAverage(stars: readonly number[]): number {
  return ratingSum(stars) / RATING_WINDOW;
}

/** "Protector animal": 4,8 o más en las calificaciones reales, sin contar las 5 estrellas iniciales. */
export function isAnimalProtector(stars: readonly number[]): boolean {
  const recent = stars.slice(0, RATING_WINDOW);
  const sum = recent.reduce((total, s) => total + s, 0);
  return recent.length > 0 && sum * 5 >= recent.length * 24;
}

/** "4,8" o "4,75": dos decimales cuando hacen falta, para que coincida con la regla de 4,8. */
export function formatRating(value: number, locale: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
