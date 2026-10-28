import { create } from "qrcode";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

const QUIET_ZONE = 2;

/** Ruta SVG con un cuadrado por módulo oscuro (corrección M: sigue legible impreso y arrugado). */
export function qrPath(value: string): { size: number; d: string } {
  const { modules } = create(value, { errorCorrectionLevel: "M" });
  let d = "";
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: modules.size + QUIET_ZONE * 2, d };
}

/** Código QR vectorial (nítido al imprimir). Siempre oscuro sobre blanco para que se pueda escanear. */
export function QrCode({ value, size = 120, label }: { value: string; size?: number; label: string }) {
  const { size: modules, d } = useMemo(() => qrPath(value), [value]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${modules} ${modules}`}>
        <Rect x={0} y={0} width={modules} height={modules} fill="#FFFFFF" />
        <Path d={d} fill="#0B2239" />
      </Svg>
    </View>
  );
}
