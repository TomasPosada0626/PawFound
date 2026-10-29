import * as Updates from "expo-updates";

/** Ventana desde que abre la app en la que todavía se puede reiniciar sin interrumpir a nadie. */
const RELOAD_WINDOW_MS = 12_000;

/**
 * Actualizaciones por EAS Update (pantallas, textos, colores): al abrir la app busca si hay una
 * publicada para su canal. Si llega en los primeros segundos, reinicia la app con la versión
 * nueva; si tarda más, queda descargada y se usa la próxima vez que se abra, para no perder lo
 * que la persona esté escribiendo. En desarrollo y en Expo Go no hace nada.
 */
export async function applyUpdateOnLaunch(startedAt: number = Date.now()): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    const { isNew } = await Updates.fetchUpdateAsync();
    if (isNew && Date.now() - startedAt < RELOAD_WINDOW_MS) await Updates.reloadAsync();
  } catch {
    // Sin red o sin servidor de actualizaciones: sigue con la versión que ya tiene.
  }
}
