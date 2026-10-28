import { useState } from "react";
import { Pressable, View } from "react-native";

import type { LatLng } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

import { Text } from "../ui/Text";
import { ClusterBubble, PetPin, PointPin } from "./pins";
import { CIRCLE_STYLE, type PetMapProps } from "./types";

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Vista previa para web (solo desarrollo de UI): react-native-maps no soporta web.
 * Proyecta los pines sobre un lienzo esquemático; en Android se usa el mapa real.
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
  onMapPress,
  height,
  testID,
}: PetMapProps) {
  const { scheme } = useTheme();
  const { t } = useI18n();
  const [size, setSize] = useState({ width: 1, height: 1 });

  const project = (p: LatLng) => ({
    x: ((p.longitude - (region.longitude - region.longitudeDelta / 2)) / region.longitudeDelta) * size.width,
    y: ((region.latitude + region.latitudeDelta / 2 - p.latitude) / region.latitudeDelta) * size.height,
  });
  const unproject = (x: number, y: number): LatLng => ({
    latitude: region.latitude + region.latitudeDelta / 2 - (y / size.height) * region.latitudeDelta,
    longitude: region.longitude - region.longitudeDelta / 2 + (x / size.width) * region.longitudeDelta,
  });
  const metersToPx = (m: number) => (m / METERS_PER_DEGREE_LAT / region.latitudeDelta) * size.height;

  const bg = scheme === "dark" ? "#15212D" : "#EEF2F0";
  const line = scheme === "dark" ? "#24364A" : "#FFFFFF";

  return (
    <View
      testID={testID}
      style={[{ overflow: "hidden", backgroundColor: bg }, height ? { height } : { flex: 1 }]}
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
        {Array.from({ length: 14 }).map((_, i) => (
          <View
            key={`h${i}`}
            style={{ position: "absolute", left: 0, right: 0, top: i * 56, height: i % 3 === 0 ? 6 : 3, backgroundColor: line }}
          />
        ))}
        {Array.from({ length: 14 }).map((_, i) => (
          <View
            key={`v${i}`}
            style={{ position: "absolute", top: 0, bottom: 0, left: i * 64, width: i % 4 === 0 ? 6 : 3, backgroundColor: line }}
          />
        ))}
        <View
          style={{
            position: "absolute",
            top: -40,
            bottom: -40,
            left: "62%",
            width: 18,
            backgroundColor: scheme === "dark" ? "#0E2A3D" : "#B9DEF0",
            transform: [{ rotate: "14deg" }],
          }}
        />
      </Pressable>

      {circles.map((circle, i) => {
        const c = project(circle.center);
        const r = metersToPx(circle.radius);
        const style = CIRCLE_STYLE[circle.variant ?? "current"];
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
              borderWidth: style.strokeWidth,
              borderStyle: circle.variant === "future" ? "dotted" : "dashed",
              borderColor: `${statusColor[circle.kind]}${style.strokeAlpha}`,
              backgroundColor: style.fill[circle.kind],
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

      <View pointerEvents="none" className="absolute bottom-2 left-2 rounded-full bg-surface/90 px-3 py-1">
        <Text variant="label" tone="muted">
          {t("map.webPreview")}
        </Text>
      </View>
    </View>
  );
}
