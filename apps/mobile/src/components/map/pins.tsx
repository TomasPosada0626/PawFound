import { View } from "react-native";

import type { ClusterItem } from "@/domain/rules";
import type { CaseKind, PetCase, Place } from "@/domain/types";
import { statusColor } from "@/theme/tokens";

import { Icon } from "../ui/Icon";
import { Text } from "../ui/Text";

/**
 * Pin de una mascota: huella blanca en un círculo del color del caso (rojo: perdida;
 * aguamarina: encontrada), con borde blanco y punta. Sin foto: se lee mejor de lejos y en
 * Android se dibuja al instante (los marcadores son una imagen fija de la vista).
 */
export function PetPin({ pet, size = 52 }: { pet: PetCase; size?: number }) {
  const ring = statusColor[pet.kind];
  return (
    <View className="items-center" style={{ width: size + 8 }}>
      <View
        className="items-center justify-center rounded-full border-[3px] border-white shadow-md shadow-black/30"
        style={{ backgroundColor: ring, width: size, height: size }}
      >
        <Icon name="paw" size={Math.round(size * 0.5)} color="#FFFFFF" />
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -2,
          borderLeftWidth: 8,
          borderRightWidth: 8,
          borderTopWidth: 11,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: ring,
        }}
      />
    </View>
  );
}

/** Pin simple (sin foto) para el punto elegido al reportar o avistar. */
export function PointPin({ kind }: { kind: CaseKind }) {
  return (
    <View className="items-center">
      <View
        className="h-11 w-11 items-center justify-center rounded-full border-[3px] border-white shadow-md shadow-black/25"
        style={{ backgroundColor: statusColor[kind] }}
      >
        <Icon name="paw" size={20} color="#FFFFFF" />
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -2,
          borderLeftWidth: 7,
          borderRightWidth: 7,
          borderTopWidth: 10,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: statusColor[kind],
        }}
      />
    </View>
  );
}

/**
 * Cluster con conteo, del color de la mayoría (rojo: perdidas; aguamarina: encontradas). Si
 * está parejo se parte en mitad rojo y mitad aguamarina, para que se lea que hay de los dos.
 */
export function ClusterBubble({ cluster }: { cluster: ClusterItem }) {
  const mixed = cluster.majority === "mixed";
  const size = Math.min(68, 46 + cluster.pets.length * 3);
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full border-[3px] border-white shadow-md shadow-black/25"
      style={{
        width: size,
        height: size,
        backgroundColor: mixed ? statusColor.found : statusColor[cluster.majority as CaseKind],
      }}
    >
      {mixed ? (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "50%", backgroundColor: statusColor.lost }} />
      ) : null}
      <Icon name="paw" size={12} color="#FFFFFF" />
      <Text variant="captionStrong" tone="white">
        {cluster.pets.length}
      </Text>
    </View>
  );
}

/**
 * Pin de veterinaria, azul para no confundirse con los casos (rojo y aguamarina). Con `rank`
 * muestra el número de la lista (1 = la más cercana) en vez del botiquín.
 */
export function PlacePin({ place, selected = false, rank }: { place: Place; selected?: boolean; rank?: number }) {
  const big = selected || rank === 1;
  return (
    <View className="items-center" accessibilityLabel={place.name}>
      <View
        style={{ backgroundColor: selected ? "#0B4AA8" : "#1D5FC9" }}
        className={`${big ? "h-12 w-12 border-[3px]" : "h-9 w-9 border-2"} items-center justify-center rounded-full border-white shadow-md shadow-black/30`}
      >
        {rank ? (
          <Text variant="subheading" tone="white" style={{ fontSize: big ? 18 : 15, lineHeight: big ? 22 : 18 }}>
            {String(rank)}
          </Text>
        ) : (
          <Icon name="medkit" size={big ? 22 : 18} color="#FFFFFF" />
        )}
      </View>
    </View>
  );
}

/** "Estás aquí": punto azul con borde blanco (el círculo azul alrededor lo dibuja el mapa). */
export function UserDot() {
  return (
    <View
      className="h-5 w-5 rounded-full border-[3px] border-white shadow-md shadow-black/30"
      style={{ backgroundColor: USER_BLUE }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export const USER_BLUE = "#1D6FE0";
/** Radio del círculo azul de "estás aquí", en metros. */
export const USER_HALO_METERS = 120;

/** Pin de una ubicación compartida en el chat: persona (actual) o bandera (punto de encuentro). */
export function SharePin({ kind }: { kind: "current" | "meeting" }) {
  const color = kind === "current" ? "#1D5FC9" : "#12B3A6";
  return (
    <View className="items-center">
      <View
        className="h-11 w-11 items-center justify-center rounded-full border-[3px] border-white shadow-md shadow-black/25"
        style={{ backgroundColor: color }}
      >
        <Icon name={kind === "current" ? "person" : "flag"} size={20} color="#FFFFFF" />
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -2,
          borderLeftWidth: 7,
          borderRightWidth: 7,
          borderTopWidth: 10,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
        }}
      />
    </View>
  );
}
