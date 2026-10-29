import { Platform } from "react-native";

import type { LatLng } from "@/domain/types";

export type NavigationApp = "google" | "waze" | "apple";

/** Apps de navegación que se ofrecen en "Vamos" (Mapas de Apple solo en iPhone). */
export function navigationApps(os: string = Platform.OS): NavigationApp[] {
  return os === "ios" ? ["google", "waze", "apple"] : ["google", "waze"];
}

/**
 * Enlace universal con la ruta hasta el destino: abre la app si está instalada y, si no, la
 * versión web. Solo lleva el destino (una veterinaria o un punto compartido), nunca la
 * ubicación de quien lo abre: la app de navegación usa la suya.
 */
export function directionsUrl(app: NavigationApp, destination: LatLng, label?: string): string {
  const point = `${destination.latitude},${destination.longitude}`;
  if (app === "waze") return `https://waze.com/ul?ll=${point}&navigate=yes`;
  if (app === "apple") {
    return `https://maps.apple.com/?daddr=${point}${label ? `&q=${encodeURIComponent(label)}` : ""}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${point}`;
}

/** Búsqueda de veterinarias en Google Maps, que usa la ubicación del propio celular. */
export function vetSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
