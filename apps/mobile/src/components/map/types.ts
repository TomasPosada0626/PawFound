import type { Region } from "@/domain/geo";
import type { ClusterItem } from "@/domain/rules";
import type { CaseKind, LatLng, PetCase } from "@/domain/types";

/**
 * Anillos del círculo de vida:
 * - current: el radio vigente (trazo punteado y relleno suave).
 * - future: cuánto crecerá (vista previa, trazo tenue).
 * - layer: capa opcional del mapa general, muy sutil para no tapar los pines.
 */
export type MapCircle = { id?: string; center: LatLng; radius: number; kind: CaseKind; variant?: "current" | "future" | "layer" };

export const CIRCLE_STYLE = {
  current: {
    strokeWidth: 2,
    dash: [10, 6],
    fill: { lost: "rgba(214,58,78,0.14)", found: "rgba(31,169,143,0.16)" },
    strokeAlpha: "FF",
  },
  future: {
    strokeWidth: 1.5,
    dash: [3, 7],
    fill: { lost: "rgba(214,58,78,0.05)", found: "rgba(31,169,143,0.06)" },
    strokeAlpha: "99",
  },
  layer: {
    strokeWidth: 1,
    dash: [6, 8],
    fill: { lost: "rgba(214,58,78,0.06)", found: "rgba(31,169,143,0.06)" },
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
  onMapPress?: (point: LatLng) => void;
  showsUserLocation?: boolean;
  satellite?: boolean;
  interactive?: boolean;
  height?: number;
  testID?: string;
};
