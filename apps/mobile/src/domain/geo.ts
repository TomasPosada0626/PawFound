import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_DEGREE_LAT = 111_320;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia en metros entre dos puntos (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Tamaño de celda para aproximar ubicaciones. Ninguna coordenada exacta sale del
 * dispositivo ni se muestra (docs/legal/tratamiento-de-datos.md, issue #46).
 */
export const APPROX_CELL_METERS = 250;

/**
 * Ajusta una coordenada al centro de su celda de ~250 m. Es determinista a propósito:
 * un desplazamiento aleatorio distinto en cada reporte se puede promediar para
 * reconstruir el punto exacto; una cuadrícula fija no filtra más que la celda.
 */
export function approximateLocation(point: LatLng, cellMeters = APPROX_CELL_METERS): LatLng {
  const latStep = cellMeters / METERS_PER_DEGREE_LAT;
  const latCell = Math.floor(point.latitude / latStep);
  const latitude = (latCell + 0.5) * latStep;
  // El paso en longitud depende de la latitud de la celda (no del punto) para que todos
  // los puntos de una misma fila compartan la misma cuadrícula.
  const lngStep = cellMeters / (METERS_PER_DEGREE_LAT * Math.cos(toRad(latitude)));
  const lngCell = Math.floor(point.longitude / lngStep);
  const longitude = (lngCell + 0.5) * lngStep;
  return { latitude: round6(latitude), longitude: round6(longitude) };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };

/** Región de mapa que muestra completo un círculo de `radius` metros, con margen. */
export function regionForRadius(center: LatLng, radius: number, padding = 1.35): Region {
  const latitudeDelta = ((radius * 2) / METERS_PER_DEGREE_LAT) * padding;
  const longitudeDelta = latitudeDelta / Math.max(0.2, Math.cos(toRad(center.latitude)));
  return { ...center, latitudeDelta, longitudeDelta };
}

/** Formatea metros como "350 m" o "1,2 km" según el idioma. */
export function formatDistance(meters: number, locale: string): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  const digits = km < 10 ? 1 : 0;
  return `${km.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 })} km`;
}

/** Centro por defecto si no hay permiso de ubicación: Laureles, Medellín. */
export const DEFAULT_CENTER: LatLng = { latitude: 6.2447, longitude: -75.5916 };
