// Doble de react-native-maps para Jest: renderiza marcadores como Views presionables.
import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { View } from "react-native";

type Props = { children?: ReactNode; testID?: string; onPress?: (e: unknown) => void; accessibilityLabel?: string };

const MapView = forwardRef<unknown, Props>(function MapView({ children, testID, onPress }, ref) {
  useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
  return (
    <View testID={testID ?? "map-view"} onTouchEnd={onPress as never}>
      {children}
    </View>
  );
});

export function Marker({ children, onPress, accessibilityLabel, testID }: Props) {
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onTouchEnd={onPress as never}
    >
      {children}
    </View>
  );
}

export function Circle() {
  return null;
}

export const PROVIDER_GOOGLE = "google";
export default MapView;
