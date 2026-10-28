import * as Location from "expo-location";
import { useCallback } from "react";

import type { LatLng } from "@/domain/types";
import { useUserLocation } from "@/store/location";

/** Nombre de zona legible ("Laureles, Medellín") a partir de un punto, si el dispositivo puede. */
export async function zoneFromPoint(point: LatLng): Promise<string | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync(point);
    if (!place) return null;
    const area = place.district ?? place.subregion ?? place.street;
    return [area, place.city].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

/** "Usar mi ubicación actual" en reportes y avistamientos: punto + zona sugerida. */
export function usePlacePicker() {
  const { request } = useUserLocation();
  return useCallback(async (): Promise<{ point: LatLng; zone: string | null } | null> => {
    const point = await request();
    if (!point) return null;
    return { point, zone: await zoneFromPoint(point) };
  }, [request]);
}
