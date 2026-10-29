import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";

import { resolveLocale, translate, translateList, type Locale, type TKey, type TParams } from "./core";

type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TKey, params?: TParams) => string;
  tList: (key: TKey) => string[];
};

const I18nContext = createContext<I18n | null>(null);

function deviceLocale(): Locale {
  try {
    return resolveLocale(getLocales()[0]?.languageCode);
  } catch {
    return "es";
  }
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? deviceLocale());

  useEffect(() => {
    if (initialLocale) return;
    void readJSON<Locale>(STORAGE_KEYS.locale).then((saved) => {
      if (saved === "es" || saved === "en") setLocaleState(saved);
    });
  }, [initialLocale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void writeJSON(STORAGE_KEYS.locale, next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      tList: (key) => translateList(locale, key),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n debe usarse dentro de <I18nProvider>");
  return ctx;
}
