import { useEffect, useState } from "react";
import { Animated, View, type ViewStyle } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

import { cn } from "./Text";

/**
 * Bloque gris que late suavemente mientras llegan los datos. Mejor que una pantalla vacía cuando
 * la API tarda (Render gratis duerme y despertarla toma hasta un minuto). No se anuncia en
 * lectores de pantalla: la lista se anuncia cuando llega.
 */
export function Skeleton({ className, style }: { className?: string; style?: ViewStyle }) {
  const { colors } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  // Las clases (tamaño, forma, color) van en un View normal: NativeWind no las aplica a
  // Animated.View. Encima, una capa del color de la tarjeta late para dar el efecto de carga.
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn("overflow-hidden rounded-xl bg-surface-alt", className)}
      style={style}
    >
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: colors.surface,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }),
        }}
      />
    </View>
  );
}

/** Lugar de una tarjeta del carrusel de mascotas (Inicio y Mapa). */
export function PetCardSkeleton({ width = 172, compact = false }: { width?: number; compact?: boolean }) {
  return (
    <View style={{ width }} className="overflow-hidden rounded-3xl border border-border/60 bg-surface">
      <Skeleton className={cn("w-full rounded-none", compact ? "h-24" : "h-32")} />
      <View className="gap-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </View>
    </View>
  );
}

/** Fila de lista (mascotas o conversaciones): foto redonda y dos líneas. */
export function RowSkeleton({ round = false }: { round?: boolean }) {
  return (
    <View className="flex-row items-center gap-3 rounded-3xl border border-border/60 bg-surface p-3">
      <Skeleton className={round ? "h-14 w-14 rounded-full" : "h-20 w-20 rounded-2xl"} />
      <View className="flex-1 gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-1/3" />
      </View>
    </View>
  );
}
