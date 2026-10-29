import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";

export type LocationConsent = "granted" | "denied" | null;

type DevicePrefs = {
  favorites: string[];
  isFavorite: (petId: string) => boolean;
  toggleFavorite: (petId: string) => void;
  /** Consentimiento propio de la app (docs/legal/consentimientos.md), previo al permiso del SO. */
  locationConsent: LocationConsent;
  /** true cuando ya se leyeron las preferencias guardadas (antes, locationConsent es null). */
  prefsLoaded: boolean;
  setLocationConsent: (value: LocationConsent) => void;
  /** Traducción automática de chats (activa por defecto). */
  autoTranslate: boolean;
  setAutoTranslate: (value: boolean) => void;
};

const DevicePrefsContext = createContext<DevicePrefs | null>(null);

export function DevicePrefsProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [locationConsent, setConsentState] = useState<LocationConsent>(null);
  const [autoTranslate, setAutoTranslateState] = useState(true);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      readJSON<string[]>(STORAGE_KEYS.favorites),
      readJSON<LocationConsent>(STORAGE_KEYS.locationConsent),
      readJSON<boolean>(STORAGE_KEYS.autoTranslate),
    ]).then(([favs, consent, translate]) => {
      if (!alive) return;
      if (Array.isArray(favs)) setFavorites(favs);
      if (consent === "granted" || consent === "denied") setConsentState(consent);
      if (typeof translate === "boolean") setAutoTranslateState(translate);
      setPrefsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleFavorite = useCallback((petId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(petId) ? prev.filter((id) => id !== petId) : [...prev, petId];
      void writeJSON(STORAGE_KEYS.favorites, next);
      return next;
    });
  }, []);

  const setLocationConsent = useCallback((value: LocationConsent) => {
    setConsentState(value);
    void writeJSON(STORAGE_KEYS.locationConsent, value);
  }, []);

  const setAutoTranslate = useCallback((value: boolean) => {
    setAutoTranslateState(value);
    void writeJSON(STORAGE_KEYS.autoTranslate, value);
  }, []);

  const value = useMemo<DevicePrefs>(
    () => ({
      favorites,
      isFavorite: (petId) => favorites.includes(petId),
      toggleFavorite,
      locationConsent,
      prefsLoaded,
      setLocationConsent,
      autoTranslate,
      setAutoTranslate,
    }),
    [favorites, toggleFavorite, locationConsent, prefsLoaded, setLocationConsent, autoTranslate, setAutoTranslate],
  );

  return <DevicePrefsContext.Provider value={value}>{children}</DevicePrefsContext.Provider>;
}

export function useDevicePrefs(): DevicePrefs {
  const ctx = useContext(DevicePrefsContext);
  if (!ctx) throw new Error("useDevicePrefs debe usarse dentro de <DevicePrefsProvider>");
  return ctx;
}
