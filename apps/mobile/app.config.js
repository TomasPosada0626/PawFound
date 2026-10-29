/**
 * Completa app.json con valores que no van en el repositorio (es público).
 *
 * GOOGLE_MAPS_API_KEY: clave de Google Maps para Android, restringida en Google Cloud a
 * "Maps SDK for Android" (y, tras el primer build, al paquete app.pawfound y su huella SHA-1).
 * En el computador se lee de apps/mobile/.env (ignorado por git); en EAS Build, de las
 * variables de entorno del proyecto en expo.dev. Se pasa al plugin de react-native-maps, como
 * indica la documentación del SDK 57. Expo Go no usa esta clave: el mapa con la clave propia
 * solo se ve en un build (APK).
 */
module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return config;
  const plugins = (config.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== "react-native-maps");
  return {
    ...config,
    plugins: [...plugins, ["react-native-maps", { androidGoogleMapsApiKey: apiKey }]],
    android: {
      ...config.android,
      config: { ...config.android?.config, googleMaps: { apiKey } },
    },
  };
};
