/** Enlaces públicos de la app (deep links verificados en app.json → android.intentFilters). */
/**
 * Dirección del sitio web (enlaces compartidos y QR). Mientras no haya dominio propio se usa la
 * gratuita de Cloudflare Pages, por ejemplo https://pawfound.pages.dev (EXPO_PUBLIC_WEB_URL).
 */
export const PUBLIC_BASE_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "https://pawfound.app").replace(/\/+$/, "");
export const SHARE_BASE_URL = `${PUBLIC_BASE_URL}/mascota/`;

/**
 * URL de la API real (por ejemplo https://api.pawfound.app). Vacía = modo demostración, con
 * todos los datos en el celular.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

/** Documentos legales (fuente: docs/legal/ del repositorio público). */
const LEGAL_BASE = "https://github.com/TomasPosada0626/PawFound/blob/main/docs/legal";
export const LEGAL_URLS = {
  terms: `${LEGAL_BASE}/terminos-y-condiciones.md`,
  privacy: `${LEGAL_BASE}/politica-de-privacidad.md`,
  guidelines: `${LEGAL_BASE}/moderacion-y-ugc.md`,
} as const;
