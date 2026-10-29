import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persistencia local de preferencias del dispositivo (tema, idioma, favoritos, borrador).
 * Nunca guarda secretos: la sesión real irá en expo-secure-store con el token de la API.
 * Toda lectura/escritura tolera fallos (almacenamiento lleno o bloqueado): la app sigue
 * funcionando con valores por defecto.
 */

export const STORAGE_KEYS = {
  theme: "pawfound.theme",
  locale: "pawfound.locale",
  favorites: "pawfound.favorites",
  locationConsent: "pawfound.locationConsent",
  reportDraft: "pawfound.reportDraft",
  session: "pawfound.session",
  autoTranslate: "pawfound.autoTranslate",
  /** Niveles de insignias ya celebrados, por cuenta (sufijo .<userId>). */
  badgesSeen: "pawfound.badgesSeen",
  /** Ids de notificaciones ya mostradas en el sistema, para no repetirlas. */
  pushShown: "pawfound.pushShown",
  /** Partes de historias ya vistas en este dispositivo. */
  storiesSeen: "pawfound.storiesSeen",
} as const;

export async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export async function writeJSON(key: string, value: unknown): Promise<void> {
  try {
    if (value === null || value === undefined) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin persistencia: el valor vive solo en memoria durante la sesión.
  }
}
