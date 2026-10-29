import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { primaryGradient } from "@/theme/tokens";

import { Icon, type IconName } from "./Icon";
import { cn, Text } from "./Text";

export type ButtonVariant = "primary" | "outline" | "soft" | "ghost" | "danger";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Segunda línea opcional (p. ej. "Chat grupal / Unirse al grupo" del mockup). */
  subtitle?: string;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  className?: string;
  compact?: boolean;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  subtitle,
  loading = false,
  disabled = false,
  accessibilityHint,
  testID,
  className,
  compact = false,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const fg =
    variant === "primary" || variant === "danger"
      ? "#FFFFFF"
      : variant === "ghost" || variant === "outline" || variant === "soft"
        ? colors.primaryStrong
        : colors.ink;
  const tone = variant === "primary" || variant === "danger" ? "white" : "primary";

  const content = (
    <View
      className={cn(
        "flex-row items-center justify-center gap-3 rounded-2xl px-5",
        compact ? "min-h-[48px] py-2" : "min-h-[54px] py-3",
        variant === "outline" && "border-[1.5px] border-primary-strong bg-surface",
        variant === "soft" && "bg-primary-soft",
        variant === "danger" && "bg-danger",
      )}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={subtitle ? 24 : 20} color={fg} /> : null}
      <View className={subtitle ? "items-start" : "items-center"}>
        <Text variant={compact ? "bodyStrong" : "subheading"} tone={tone} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone={tone} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${label}. ${subtitle}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      className={cn("active:opacity-80", inactive && "opacity-50", className)}
    >
      {variant === "primary" ? (
        <LinearGradient colors={primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 16 }}>
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}
