const fs = require("node:fs");
const path = require("node:path");

/**
 * Completa app.json con valores que no van en el repositorio (es público).
 *
 * GOOGLE_MAPS_API_KEY: clave de Google Maps para Android, restringida en Google Cloud a
 * "Maps SDK for Android" (y, tras el primer build, al paquete app.pawfound y su huella SHA-1).
 * En el computador se lee de apps/mobile/.env (ignorado por git); en EAS Build, de las
 * variables de entorno del proyecto en expo.dev. Se pasa al plugin de react-native-maps, como
 * indica la documentación del SDK 57. Expo Go no usa esta clave: el mapa con la clave propia
 * solo se ve en un build (APK).
 *
 * GOOGLE_SERVICES_JSON: archivo google-services.json de Firebase, necesario para que Android
 * reciba notificaciones push (Firebase Cloud Messaging). En EAS Build es una variable de tipo
 * archivo (expo.dev → Environment variables); en el computador, apps/mobile/google-services.json
 * (ignorado por git). Sin él, la app funciona igual pero sin push en Android.
 */
module.exports = ({ config }) => {
  let next = { ...config, android: { ...config.android } };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    const plugins = (next.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== "react-native-maps");
    next = {
      ...next,
      plugins: [...plugins, ["react-native-maps", { androidGoogleMapsApiKey: apiKey }]],
      android: { ...next.android, config: { ...next.android.config, googleMaps: { apiKey } } },
    };
  }

  // Expo y EAS evalúan este archivo desde apps/mobile.
  const localServices = path.join(process.cwd(), "google-services.json");
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(localServices) ? "./google-services.json" : undefined);
  if (googleServicesFile) next.android.googleServicesFile = googleServicesFile;

  return next;
};
