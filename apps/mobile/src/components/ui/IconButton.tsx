import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./Icon";
import { cn } from "./Text";

type IconButtonProps = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  /** "surface" = botón flotante redondo con sombra (mockups); "plain" = solo ícono. */
  variant?: "surface" | "plain" | "soft";
  selected?: boolean;
  color?: string;
  size?: number;
  badge?: boolean;
  testID?: string;
  disabled?: boolean;
};

/** Botón de solo ícono con touch target ≥ 48dp y label obligatorio para TalkBack. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = "plain",
  selected,
  color,
  size = 24,
  badge = false,
  testID,
  disabled,
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? { disabled } : { selected, disabled }}
      hitSlop={4}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      className={cn(
        "h-12 w-12 items-center justify-center rounded-full active:opacity-70",
        variant === "surface" && "bg-surface shadow-md shadow-black/10",
        variant === "soft" && "bg-primary-soft",
        selected && variant === "plain" && "bg-primary-soft",
      )}
    >
      <Icon name={icon} size={size} color={color ?? (selected ? colors.primaryStrong : colors.muted)} />
      {badge ? <View className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-lost" /> : null}
    </Pressable>
  );
}
