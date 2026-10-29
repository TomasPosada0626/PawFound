import { useState } from "react";
import { Image, Pressable, View } from "react-native";

import type { LatLng } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

import { Text } from "../ui/Text";
import { ClusterBubble, PetPin, PlacePin, PointPin, SharePin, USER_BLUE, USER_HALO_METERS, UserDot } from "./pins";
import { CIRCLE_STYLE, type PetMapProps } from "./types";

const TILE = 256;
const METERS_PER_PIXEL_Z0 = 156_543.033_92;

// Proyección Web Mercator (la misma de los mosaicos), en píxeles de mundo para un zoom dado.
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};
const lngAt = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latAt = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

/**
 * Vista previa para web (solo desarrollo de UI): react-native-maps no soporta web, así que se
 * dibujan mosaicos de OpenStreetMap (uso liviano, con atribución) con la misma proyección de los
 * pines; en oscuro se oscurecen con una capa. En Android se usa Google Maps con mapStyles.ts.
 */
export function PetMap({
  region,
  clusters = [],
  onPetPress,
  onClusterPress,
  pinLabel,
  clusterLabel,
  circles = [],
  marker,
  shareMarker,
  onMapPress,
  places = [],
  onPlacePress,
  selectedPlaceId,
  numberedPlaces = false,
  userLocation,
  height,
  testID,
}: PetMapProps) {
  const { scheme } = useTheme();
  const { t } = useI18n();
  const [size, setSize] = useState({ width: 1, height: 1 });

  // Zoom (fraccionario) que muestra toda la región, como hace el mapa nativo.
  const spanY0 = worldY(region.latitude - region.latitudeDelta / 2, 0) - worldY(region.latitude + region.latitudeDelta / 2, 0);
  const spanX0 = (region.longitudeDelta / 360) * TILE;
  const zoom = Math.min(19, Math.max(3, Math.min(Math.log2(size.height / spanY0), Math.log2(size.width / spanX0))));
  const tileZoom = Math.floor(zoom);
  const tileSize = TILE * 2 ** (zoom - tileZoom);
  const left = worldX(region.longitude, zoom) - size.width / 2;
  const top = worldY(region.latitude, zoom) - size.height / 2;

  const project = (p: LatLng) => ({ x: worldX(p.longitude, zoom) - left, y: worldY(p.latitude, zoom) - top });
  const unproject = (x: number, y: number): LatLng => ({ latitude: latAt(y + top, zoom), longitude: lngAt(x + left, zoom) });
  const metersToPx = (m: number) => m / ((METERS_PER_PIXEL_Z0 * Math.cos((region.latitude * Math.PI) / 180)) / 2 ** zoom);

  const tiles: { key: string; uri: string; x: number; y: number }[] = [];
  if (size.width > 1) {
    const max = 2 ** tileZoom;
    for (let tx = Math.floor(left / tileSize); tx <= Math.floor((left + size.width) / tileSize); tx++) {
      for (let ty = Math.floor(top / tileSize); ty <= Math.floor((top + size.height) / tileSize); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wrapped = ((tx % max) + max) % max;
        tiles.push({
          key: `${tileZoom}-${tx}-${ty}`,
          uri: `https://tile.openstreetmap.org/${tileZoom}/${wrapped}/${ty}.png`,
          x: tx * tileSize - left,
          y: ty * tileSize - top,
        });
      }
    }
  }

  return (
    <View
      testID={testID}
      style={[
        { overflow: "hidden", backgroundColor: scheme === "dark" ? "#13202C" : "#EEF1F3" },
        height ? { height } : { flex: 1 },
      ]}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <Pressable
        accessible={false}
        style={{ position: "absolute", inset: 0 }}
        onPress={(e) => {
          const ne = e.nativeEvent as unknown as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
          onMapPress?.(unproject(ne.locationX ?? ne.offsetX ?? 0, ne.locationY ?? ne.offsetY ?? 0));
        }}
      >
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tile.uri }}
            accessible={false}
            style={{ position: "absolute", left: tile.x, top: tile.y, width: tileSize, height: tileSize }}
          />
        ))}
        {scheme === "dark" ? (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: "rgba(10,21,32,0.6)" }} />
        ) : null}
      </Pressable>

      {circles.map((circle, i) => {
        const c = project(circle.center);
        const r = metersToPx(circle.radius);
        const ring = CIRCLE_STYLE[circle.variant ?? "current"];
        return (
          <View
            key={circle.id ?? `${circle.variant ?? "current"}-${i}`}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: c.x - r,
              top: c.y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              borderWidth: ring.strokeWidth,
              borderStyle: circle.variant === "future" ? "dotted" : circle.variant === "focus" ? "solid" : "dashed",
              borderColor: `${statusColor[circle.kind]}${ring.strokeAlpha}`,
              backgroundColor: ring.fill[circle.kind],
            }}
          />
        );
      })}

      {clusters.map((cluster) => {
        const single = cluster.pets.length === 1 ? cluster.pets[0] : undefined;
        const p = project(single ? single.location : { latitude: cluster.latitude, longitude: cluster.longitude });
        return (
          <Pressable
            key={cluster.id}
            accessibilityRole="button"
            accessibilityLabel={single ? pinLabel?.(single) : clusterLabel?.(cluster)}
            onPress={() => (single ? onPetPress?.(single) : onClusterPress?.(cluster))}
            style={{ position: "absolute", left: p.x - 32, top: p.y - (single ? 70 : 32) }}
            testID={single ? `pin-${single.id}` : `cluster-${cluster.id}`}
          >
            {single ? <PetPin pet={single} /> : <ClusterBubble cluster={cluster} />}
          </Pressable>
        );
      })}

      {marker
        ? (() => {
            const p = project(marker.coordinate);
            return (
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: p.x - (marker.pet ? 36 : 22), top: p.y - (marker.pet ? 82 : 54) }}
              >
                {marker.pet ? <PetPin pet={marker.pet} size={64} /> : <PointPin kind={marker.kind} />}
              </View>
            );
          })()
        : null}

      {places.map((place, index) => {
        const p = project(place.location);
        const half = place.id === selectedPlaceId ? 24 : 18;
        return (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            accessibilityLabel={place.name}
            onPress={() => onPlacePress?.(place)}
            style={{ position: "absolute", left: p.x - half, top: p.y - half, zIndex: place.id === selectedPlaceId ? 2 : 1 }}
            testID={`place-${place.id}`}
          >
            <PlacePin place={place} selected={place.id === selectedPlaceId} rank={numberedPlaces ? index + 1 : undefined} />
          </Pressable>
        );
      })}

      {userLocation
        ? (() => {
            const p = project(userLocation);
            const r = Math.max(14, metersToPx(USER_HALO_METERS));
            return (
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: p.x - r, top: p.y - r, width: r * 2, height: r * 2 }}
              >
                <View
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: r,
                    borderWidth: 1.5,
                    borderColor: `${USER_BLUE}99`,
                    backgroundColor: `${USER_BLUE}29`,
                  }}
                />
                <View style={{ position: "absolute", left: r - 10, top: r - 10 }}>
                  <UserDot />
                </View>
              </View>
            );
          })()
        : null}

      {shareMarker
        ? (() => {
            const p = project(shareMarker.coordinate);
            return (
              <View pointerEvents="none" style={{ position: "absolute", left: p.x - 22, top: p.y - 54 }}>
                <SharePin kind={shareMarker.kind} />
              </View>
            );
          })()
        : null}

      <View pointerEvents="none" className="absolute bottom-1.5 right-2 rounded-full bg-surface/85 px-2 py-0.5">
        <Text variant="label" tone="muted" style={{ fontSize: 10 }}>
          {`${t("map.webPreview")} · © OpenStreetMap`}
        </Text>
      </View>
    </View>
  );
}
