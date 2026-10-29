import type { Region } from "@/domain/geo";
import type { ClusterItem } from "@/domain/rules";
import type { CaseKind, LatLng, PetCase, Place } from "@/domain/types";

/**
 * Anillos del círculo de vida:
 * - current: el radio vigente (trazo punteado y relleno suave).
 * - focus: el radio vigente de la mascota elegida en el mapa (trazo continuo y relleno claro
 *   bien visible: rojo si está perdida, aguamarina si fue encontrada).
 * - future: hasta dónde crecerá (anillo punteado tenue; 2 km en las perdidas).
 * - layer: capa opcional del mapa general, muy sutil para no tapar los pines.
 */
export type MapCircle = {
  id?: string;
  center: LatLng;
  radius: number;
  kind: CaseKind;
  variant?: "current" | "focus" | "future" | "layer";
};

export const CIRCLE_STYLE = {
  focus: {
    strokeWidth: 3,
    dash: [] as number[],
    fill: { lost: "rgba(224,36,36,0.2)", found: "rgba(18,179,166,0.22)" },
    strokeAlpha: "FF",
  },
  current: {
    strokeWidth: 2,
    dash: [10, 6],
    fill: { lost: "rgba(224,36,36,0.14)", found: "rgba(18,179,166,0.16)" },
    strokeAlpha: "FF",
  },
  future: {
    strokeWidth: 1.5,
    dash: [3, 7],
    fill: { lost: "rgba(224,36,36,0.05)", found: "rgba(18,179,166,0.06)" },
    strokeAlpha: "99",
  },
  layer: {
    strokeWidth: 1,
    dash: [6, 8],
    fill: { lost: "rgba(224,36,36,0.06)", found: "rgba(18,179,166,0.06)" },
    strokeAlpha: "80",
  },
} as const;

export type PetMapProps = {
  region: Region;
  onRegionChange?: (region: Region) => void;
  clusters?: ClusterItem[];
  onPetPress?: (pet: PetCase) => void;
  onClusterPress?: (cluster: ClusterItem) => void;
  /** Etiqueta accesible por pin (calculada por la pantalla, que conoce idioma y distancia). */
  pinLabel?: (pet: PetCase) => string;
  clusterLabel?: (cluster: ClusterItem) => string;
  circles?: MapCircle[];
  /** Pin simple (punto elegido al reportar o el centro del detalle). */
  marker?: { coordinate: LatLng; kind: CaseKind; pet?: PetCase };
  /** Ubicación compartida en el chat (actual o punto de encuentro). */
  shareMarker?: { coordinate: LatLng; kind: "current" | "meeting" };
  onMapPress?: (point: LatLng) => void;
  /** Capa de veterinarias. */
  places?: Place[];
  onPlacePress?: (place: Place) => void;
  /** Veterinaria resaltada (la elegida en la lista). */
  selectedPlaceId?: string;
  /** Numera los pines de las veterinarias (1 = la más cercana) para ligarlos con la lista. */
  numberedPlaces?: boolean;
  /** Mapa estático y liviano (Android): para las tarjetas de ubicación dentro del chat. */
  lite?: boolean;
  showsUserLocation?: boolean;
  satellite?: boolean;
  interactive?: boolean;
  height?: number;
  testID?: string;
};
