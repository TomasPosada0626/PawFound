/** Enlaces públicos de la app (deep links verificados en app.json → android.intentFilters). */
export const PUBLIC_BASE_URL = "https://pawfound.app";
export const SHARE_BASE_URL = `${PUBLIC_BASE_URL}/mascota/`;

/** Documentos legales (fuente: docs/legal/ del repositorio público). */
const LEGAL_BASE = "https://github.com/TomasPosada0626/PawFound/blob/main/docs/legal";
export const LEGAL_URLS = {
  terms: `${LEGAL_BASE}/terminos-y-condiciones.md`,
  privacy: `${LEGAL_BASE}/politica-de-privacidad.md`,
  guidelines: `${LEGAL_BASE}/moderacion-y-ugc.md`,
} as const;
