import { useColorScheme as useNativeWindScheme } from "nativewind";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme as useSystemScheme } from "react-native";

import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";

import { palettes, type ColorScheme, type Palette } from "./tokens";

export type ThemePreference = "light" | "dark" | "system";

type Theme = {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  scheme: ColorScheme;
  colors: Palette;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemScheme();
  const { setColorScheme } = useNativeWindScheme();
  const [preference, setPrefState] = useState<ThemePreference>("system");

  useEffect(() => {
    void readJSON<ThemePreference>(STORAGE_KEYS.theme).then((saved) => {
      if (saved === "light" || saved === "dark") setPrefState(saved);
    });
  }, []);

  // Se resuelve aquí y se le pasa a NativeWind siempre "light" o "dark" explícito: con
  // darkMode "class", "system" no aplica la clase en web y los colores JS y CSS divergían.
  const scheme: ColorScheme = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  useEffect(() => {
    try {
      setColorScheme(scheme);
    } catch {
      // Sin la hoja de estilos compilada (p. ej. en Jest) NativeWind no conoce darkMode
      // "class" y lanza; la paleta JS sigue funcionando igual.
    }
  }, [scheme, setColorScheme]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPrefState(pref);
    void writeJSON(STORAGE_KEYS.theme, pref === "system" ? null : pref);
  }, []);

  const value = useMemo<Theme>(
    () => ({ preference, setPreference, scheme, colors: palettes[scheme] }),
    [preference, setPreference, scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
