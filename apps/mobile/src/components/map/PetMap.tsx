import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";

import type { ClusterItem } from "@/domain/rules";
import type { PetCase, LatLng } from "@/domain/types";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

import { darkMapStyle, lightMapStyle } from "./mapStyles";

import { ClusterBubble, PetPin, PlacePin, PointPin, SharePin, USER_BLUE, USER_HALO_METERS, UserDot } from "./pins";
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
  shareMarker,
  onMapPress,
  places = [],
  onPlacePress,
  selectedPlaceId,
  numberedPlaces = false,
  lite = false,
  showsUserLocation,
  userLocation,
  recenterKey,
  satellite,
  interactive = true,
  height,
  testID,
}: PetMapProps) {
  const { scheme } = useTheme();
  const ref = useRef<MapView>(null);
  // Mientras la persona se mueve, Google avisa su posición y el círculo azul la sigue.
  const [liveMe, setLiveMe] = useState<LatLng | null>(null);
  const me = userLocation ? (liveMe ?? userLocation) : null;

  // Se compara por valor: así un mapa que la persona movió no salta de vuelta en cada render.
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  useEffect(() => {
    ref.current?.animateToRegion({ latitude, longitude, latitudeDelta, longitudeDelta }, 350);
  }, [latitude, longitude, latitudeDelta, longitudeDelta, recenterKey]);

  return (
    <View style={height ? { height } : { flex: 1 }} testID={testID}>
      <MapView
        ref={ref}
        style={{ flex: 1 }}
        initialRegion={region}
        customMapStyle={scheme === "dark" ? darkMapStyle : lightMapStyle}
        mapType={satellite ? "hybrid" : "standard"}
        showsUserLocation={showsUserLocation || Boolean(userLocation)}
        onUserLocationChange={
          userLocation
            ? (e) => {
                const c = e.nativeEvent.coordinate;
                if (c) setLiveMe({ latitude: c.latitude, longitude: c.longitude });
              }
            : undefined
        }
        showsMyLocationButton={false}
        toolbarEnabled={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        liteMode={lite}
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
              lineDashPattern={style.dash.length ? [...style.dash] : undefined}
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
        {places.map((place, index) => (
          <Marker
            key={`${place.id}-${place.id === selectedPlaceId ? "on" : "off"}-${numberedPlaces ? index : ""}`}
            coordinate={place.location}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => onPlacePress?.(place)}
            tracksViewChanges={false}
            accessibilityLabel={place.name}
            testID={`place-${place.id}`}
            zIndex={place.id === selectedPlaceId ? 2 : 1}
          >
            <PlacePin place={place} selected={place.id === selectedPlaceId} rank={numberedPlaces ? index + 1 : undefined} />
          </Marker>
        ))}
        {shareMarker ? (
          <Marker coordinate={shareMarker.coordinate} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
            <SharePin kind={shareMarker.kind} />
          </Marker>
        ) : null}
        {me ? (
          <>
            <Circle
              center={me}
              radius={USER_HALO_METERS}
              strokeColor={`${USER_BLUE}99`}
              fillColor={`${USER_BLUE}29`}
              strokeWidth={1.5}
            />
            <Marker coordinate={me} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={3}>
              <UserDot />
            </Marker>
          </>
        ) : null}
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
  // En Android el marcador personalizado es una imagen fija de la vista: se redibuja un momento
  // (el ícono de la huella) y luego se congela por rendimiento.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracks(false), 600);
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
