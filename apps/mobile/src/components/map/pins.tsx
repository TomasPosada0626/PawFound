import { View } from "react-native";

import type { ClusterItem } from "@/domain/rules";
import type { CaseKind, PetCase, Place } from "@/domain/types";
import { statusColor } from "@/theme/tokens";

import { PetPhoto } from "../pets";
import { Icon } from "../ui/Icon";
import { Text } from "../ui/Text";

/** Pin del mockup: foto en círculo con borde del color del caso, huella y punta. */
export function PetPin({ pet, size = 56 }: { pet: PetCase; size?: number }) {
  const ring = statusColor[pet.kind];
  return (
    <View className="items-center" style={{ width: size + 8 }}>
      <View
        className="rounded-full p-[3px] shadow-md shadow-black/25"
        style={{ backgroundColor: ring, width: size, height: size }}
      >
        <View className="flex-1 overflow-hidden rounded-full border-2 border-white">
          <PetPhoto pet={pet} rounded="rounded-full" className="h-full w-full" />
        </View>
        <View
          className="absolute -bottom-0.5 -right-1 h-5 w-5 items-center justify-center rounded-full border-2 border-white"
          style={{ backgroundColor: ring }}
        >
          <Icon name="paw" size={10} color="#FFFFFF" />
        </View>
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

/** Cluster con conteo; color por mayoría y neutro si está parejo (docs/flujos/mapa-e-inicio.md §3). */
export function ClusterBubble({ cluster }: { cluster: ClusterItem }) {
  const color = cluster.majority === "mixed" ? "#0B2545" : statusColor[cluster.majority];
  const size = Math.min(68, 46 + cluster.pets.length * 3);
  return (
    <View
      className="items-center justify-center rounded-full border-[3px] border-white shadow-md shadow-black/25"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      <Icon name="paw" size={12} color="#FFFFFF" />
      <Text variant="captionStrong" tone="white">
        {cluster.pets.length}
      </Text>
    </View>
  );
}

/** Pin de veterinaria (cruz) o refugio (casa), azul para no confundirse con los casos. */
export function PlacePin({ place }: { place: Place }) {
  return (
    <View className="items-center">
      <View
        style={{ backgroundColor: place.kind === "vet" ? "#1D5FC9" : "#6D4AD6" }}
        className="h-9 w-9 items-center justify-center rounded-full border-2 border-white shadow-sm shadow-black/30"
      >
        <Icon name={place.kind === "vet" ? "medkit" : "home"} size={18} color="#FFFFFF" />
      </View>
    </View>
  );
}
