import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** Íconos decorativos: el significado siempre lo lleva el texto o el accessibilityLabel del padre. */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}
