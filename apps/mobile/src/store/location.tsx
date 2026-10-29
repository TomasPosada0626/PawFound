import * as Location from "expo-location";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_CENTER } from "@/domain/geo";
import type { LatLng } from "@/domain/types";

import { useDevicePrefs } from "./devicePrefs";

type LocationState = {
  /** Ubicación conocida o el centro por defecto (Laureles). Solo vive en el dispositivo. */
  location: LatLng;
  hasRealLocation: boolean;
  status: "unknown" | "granted" | "denied";
  /** Pide el permiso del sistema (después del consentimiento propio) y actualiza la ubicación. */
  request: () => Promise<LatLng | null>;
};

const LocationContext = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { locationConsent } = useDevicePrefs();
  const [location, setLocation] = useState<LatLng>(DEFAULT_CENTER);
  const [hasRealLocation, setHasReal] = useState(false);
  const [status, setStatus] = useState<LocationState["status"]>("unknown");

  const read = useCallback(async (): Promise<LatLng | null> => {
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setLocation(point);
      setHasReal(true);
      return point;
    } catch {
      return null;
    }
  }, []);

  const request = useCallback(async () => {
    try {
      const { status: result } = await Location.requestForegroundPermissionsAsync();
      if (result !== "granted") {
        setStatus("denied");
        return null;
      }
      setStatus("granted");
      return await read();
    } catch {
      setStatus("denied");
      return null;
    }
  }, [read]);

  // Si ya hubo consentimiento y permiso, refresca en silencio al abrir la app.
  useEffect(() => {
    if (locationConsent !== "granted") return;
    let alive = true;
    void Location.getForegroundPermissionsAsync()
      .then(async ({ status: current }) => {
        if (!alive) return;
        if (current === "granted") {
          setStatus("granted");
          await read();
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [locationConsent, read]);

  const value = useMemo(() => ({ location, hasRealLocation, status, request }), [location, hasRealLocation, status, request]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useUserLocation(): LocationState {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useUserLocation debe usarse dentro de <LocationProvider>");
  return ctx;
}
