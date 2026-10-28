import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";

import type { ClusterItem } from "@/domain/rules";
import type { PetCase } from "@/domain/types";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

import { darkMapStyle, lightMapStyle } from "./mapStyles";
import { ClusterBubble, PetPin, PointPin, PlacePin } from "./pins";
import { CIRCLE_STYLE, type PetMapProps } from "./types";

/**
 * Mapa nativo (Google Maps en Android). En Expo Go funciona sin configuración; para un
 * build propio se necesita una API key en app.json → android.config.googleMaps.apiKey.
 */
export function PetMap({
  region,
  onRegionChange,
  clusters = [],
  onPetPress,
  onClusterPress,
  pinLabel,
  clusterLabel,
  circles = [],
  marker,
  onMapPress,
  places = [],
  onPlacePress,
  showsUserLocation,
  satellite,
  interactive = true,
  height,
  testID,
}: PetMapProps) {
  const { scheme } = useTheme();
  const ref = useRef<MapView>(null);

  useEffect(() => {
    ref.current?.animateToRegion(region, 350);
  }, [region]);

  return (
    <View style={height ? { height } : { flex: 1 }} testID={testID}>
      <MapView
        ref={ref}
        style={{ flex: 1 }}
        initialRegion={region}
        customMapStyle={scheme === "dark" ? darkMapStyle : lightMapStyle}
        mapType={satellite ? "hybrid" : "standard"}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        onRegionChangeComplete={(r) => onRegionChange?.(r)}
        onPress={(e) => onMapPress?.(e.nativeEvent.coordinate)}
      >
        {circles.map((c, i) => {
          const style = CIRCLE_STYLE[c.variant ?? "current"];
          return (
            <Circle
              key={c.id ?? `${c.variant ?? "current"}-${i}`}
              center={c.center}
              radius={c.radius}
              strokeColor={`${statusColor[c.kind]}${style.strokeAlpha}`}
              fillColor={style.fill[c.kind]}
              strokeWidth={style.strokeWidth}
              lineDashPattern={[...style.dash]}
            />
          );
        })}
        {clusters.map((cluster) =>
          cluster.pets.length === 1 ? (
            <PetMarker
              key={cluster.id}
              pet={cluster.pets[0] as PetCase}
              label={pinLabel?.(cluster.pets[0] as PetCase)}
              onPress={() => onPetPress?.(cluster.pets[0] as PetCase)}
            />
          ) : (
            <ClusterMarker
              key={cluster.id}
              cluster={cluster}
              label={clusterLabel?.(cluster)}
              onPress={() => onClusterPress?.(cluster)}
            />
          ),
        )}
        {places.map((place) => (
          <Marker
            key={place.id}
            coordinate={place.location}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onPlacePress?.(place)}
            tracksViewChanges={false}
            accessibilityLabel={place.name}
            testID={`place-${place.id}`}
          >
            <PlacePin place={place} />
          </Marker>
        ))}
        {marker ? (
          <Marker coordinate={marker.coordinate} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
            {marker.pet ? <PetPin pet={marker.pet} size={64} /> : <PointPin kind={marker.kind} />}
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

function PetMarker({ pet, label, onPress }: { pet: PetCase; label?: string; onPress: () => void }) {
  // En Android el marcador personalizado es una "foto" de la vista: se sigue redibujando
  // un momento para capturar la imagen ya cargada y luego se congela por rendimiento.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracks(false), 1500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Marker
      coordinate={pet.location}
      anchor={{ x: 0.5, y: 1 }}
      onPress={onPress}
      tracksViewChanges={tracks}
      accessibilityLabel={label}
      testID={`pin-${pet.id}`}
    >
      <PetPin pet={pet} />
    </Marker>
  );
}

function ClusterMarker({ cluster, label, onPress }: { cluster: ClusterItem; label?: string; onPress: () => void }) {
  return (
    <Marker
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      onPress={onPress}
      tracksViewChanges={false}
      accessibilityLabel={label}
      testID={`cluster-${cluster.id}`}
    >
      <ClusterBubble cluster={cluster} />
    </Marker>
  );
}
