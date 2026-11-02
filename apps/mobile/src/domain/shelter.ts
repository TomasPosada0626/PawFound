/** Pesos de la DIAN para el dígito de verificación del NIT, de derecha a izquierda (igual que la API). */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export type ShelterStatus = "pending" | "verified" | "rejected";

/** Dígito de verificación de un NIT colombiano (solo dígitos, sin el dígito final). */
export function nitCheckDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += Number(base[base.length - 1 - i]) * (NIT_WEIGHTS[i] ?? 0);
  const r = sum % 11;
  return r >= 2 ? 11 - r : r;
}

/** Acepta "900.123.456-8", "900123456-8" o "9001234568"; devuelve "900123456-8" si es válido. */
export function normalizeNit(raw: string): string | null {
  const clean = raw.trim().replace(/[.\s-]/g, "");
  if (!/^\d+$/.test(clean) || clean.length < 7 || clean.length > NIT_WEIGHTS.length + 1) return null;
  const base = clean.slice(0, -1);
  const check = Number(clean.slice(-1));
  return nitCheckDigit(base) === check ? `${base}-${check}` : null;
}
