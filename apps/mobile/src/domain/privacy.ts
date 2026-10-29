/**
 * Minimización de datos personales frente a otras personas usuarias (PRODUCT.md):
 * el autor de un reporte se muestra con nombre corto e inicial, nunca el nombre completo,
 * y el teléfono/correo propios solo se muestran enmascarados.
 */

/** "Valentina Arango Pérez" → "Valentina A." */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const [first, second] = parts;
  return second ? `${first} ${second.charAt(0).toUpperCase()}.` : (first ?? "");
}

/** Iniciales para avatares sin foto: "Valentina Arango" → "VA" */
export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

/** "+573001234567" → "+57 300 *** **67" */
export function maskPhone(e164: string): string {
  const n = e164.replace(/^\+57/, "");
  if (n.length !== 10) return "***";
  return `+57 ${n.slice(0, 3)} *** **${n.slice(8)}`;
}

/** "tomas.posada@gmail.com" → "to•••••••@gmail.com" */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"•".repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}
