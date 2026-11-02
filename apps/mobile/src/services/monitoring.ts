import * as Sentry from "@sentry/react-native";

/**
 * Errores de la app en Sentry. Sin EXPO_PUBLIC_SENTRY_DSN no envía nada. Nunca datos personales:
 * sin IP ni cuerpos de peticiones, y las direcciones se recortan porque llevan ids de casos y chats.
 */
export function startMonitoring(dsn = process.env.EXPO_PUBLIC_SENTRY_DSN) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: (crumb) => (crumb.category === "http" || crumb.category === "navigation" ? null : crumb),
    beforeSend: (event) => {
      delete event.user;
      if (event.request) event.request = { method: event.request.method };
      return event;
    },
  });
  return true;
}
