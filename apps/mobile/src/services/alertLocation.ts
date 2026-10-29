import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import type { LatLng } from "@/domain/types";

/**
 * Ubicación para la Alerta Ángel (decisión de producto: alertas según dónde estás, no una zona
 * fija). El sistema despierta esta tarea cuando la persona se mueve unos 250 m; la app solo
 * entrega el punto al backend, que lo aproxima a una celda de 250 m y guarda únicamente el
 * último, sin historial. No se usa servicio en primer plano (sin notificación fija y con menos
 * batería): Android puede espaciar las actualizaciones con la app cerrada, lo que basta para
 * alertas que se cuentan en minutos.
 *
 * defineTask debe correr al cargar la app (se importa en app/_layout.tsx).
 */

export const ALERT_LOCATION_TASK = "pawfound-alert-location";

type Sink = (point: LatLng) => void | Promise<void>;
let sink: Sink | null = null;

/** Quién recibe los puntos (BackendServices lo conecta con la cuenta actual). */
export function setAlertLocationSink(next: Sink | null) {
  sink = next;
}

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(ALERT_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length || !sink) return;
  const last = data.locations[data.locations.length - 1];
  if (last) await sink({ latitude: last.coords.latitude, longitude: last.coords.longitude });
});

export type AlertLocationMode = "always" | "foreground" | "off";

/** "always": llega con la app cerrada; "foreground": solo al abrirla; "off": sin permiso. */
export async function startAlertLocation(): Promise<AlertLocationMode> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return "off";
  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== "granted") return "foreground";
    await Location.startLocationUpdatesAsync(ALERT_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 250,
      deferredUpdatesDistance: 250,
      deferredUpdatesInterval: 10 * 60_000,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: false,
    });
    return "always";
  } catch {
    // Expo Go y algunos equipos no permiten ubicación en segundo plano: queda al abrir la app.
    return "foreground";
  }
}

export async function stopAlertLocation(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(ALERT_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(ALERT_LOCATION_TASK);
    }
  } catch {
    // Si la tarea no existía, no hay nada que detener.
  }
}

export async function alertLocationMode(): Promise<AlertLocationMode> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return "off";
    return (await Location.hasStartedLocationUpdatesAsync(ALERT_LOCATION_TASK)) ? "always" : "foreground";
  } catch {
    return "off";
  }
}

/** Punto actual para refrescar la ubicación al abrir la app (solo con permiso ya concedido). */
export async function currentPoint(): Promise<LatLng | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const known = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    const position = known ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}
