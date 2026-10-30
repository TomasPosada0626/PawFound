import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "@/components/ui/Toast";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/core";
import type { Backend } from "@/services/backend";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";
import { BackendProvider, useBackend } from "@/store/backend";
import { DevicePrefsProvider } from "@/store/devicePrefs";
import { LocationProvider } from "@/store/location";
import { ThemeProvider } from "@/theme/ThemeProvider";

/**
 * Restaura la sesión guardada y solo entonces muestra las rutas: así un enlace directo (p. ej.
 * a un chat) no rebota al login antes de tiempo. La sesión queda guardada siempre, se entre por
 * login, registro o Google, y solo se borra cuando la persona la cierra.
 */
function SessionGate({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void readJSON<string>(STORAGE_KEYS.session)
      .then(async (userId) => {
        if (userId && !backend.getSnapshot().sessionUserId) await backend.restoreSession(userId);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [backend]);
  return ready ? (
    <>
      <SessionPersist />
      {children}
    </>
  ) : null;
}

/** Guarda la cuenta abierta para restaurarla al volver a abrir la app. */
function SessionPersist() {
  const sessionUserId = useSyncedSession();
  useEffect(() => {
    if (sessionUserId) void writeJSON(STORAGE_KEYS.session, sessionUserId);
  }, [sessionUserId]);
  return null;
}

/** Mantiene el idioma del perfil igual al de la app (destino de la traducción de chats). */
function LanguageSync() {
  const backend = useBackend();
  const { locale } = useI18n();
  const sessionUserId = useSyncedSession();
  useEffect(() => {
    if (sessionUserId) void backend.setLanguage(locale);
  }, [backend, locale, sessionUserId]);
  return null;
}

function useSyncedSession() {
  const backend = useBackend();
  return useSyncExternalStore(backend.subscribe, () => backend.getSnapshot().sessionUserId);
}

export function AppProviders({ children, backend, locale }: { children: ReactNode; backend?: Backend; locale?: Locale }) {
  return (
    <SafeAreaProvider>
      <BackendProvider backend={backend}>
        <I18nProvider initialLocale={locale}>
          <ThemeProvider>
            <DevicePrefsProvider>
              <LocationProvider>
                <ToastProvider>
                  <SessionGate>
                    <LanguageSync />
                    {children}
                  </SessionGate>
                </ToastProvider>
              </LocationProvider>
            </DevicePrefsProvider>
          </ThemeProvider>
        </I18nProvider>
      </BackendProvider>
    </SafeAreaProvider>
  );
}
