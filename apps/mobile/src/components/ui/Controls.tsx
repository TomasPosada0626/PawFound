import type { ReactNode } from "react";
import { Pressable, Switch, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./Icon";
import { cn, Text } from "./Text";

/** Casilla con área táctil de 48dp. `children` permite enlaces dentro del texto. */
export function Checkbox({
  checked,
  onChange,
  label,
  children,
  error,
  testID,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  children?: ReactNode;
  error?: string;
  testID?: string;
}) {
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        testID={testID}
        className="min-h-[48px] flex-row items-center gap-3 py-1"
      >
        <View
          className={cn(
            "h-6 w-6 items-center justify-center rounded-md border-2",
            checked ? "border-primary-strong bg-primary-strong" : error ? "border-danger" : "border-muted",
          )}
        >
          {checked ? <Icon name="checkmark" size={16} color="#FFFFFF" /> : null}
        </View>
        {/* shrink y no flex-1: en una fila sin ancho fijo (login), flex-1 deja el texto con ancho
            cero en Android, partido letra por letra en una columna invisible y muy alta. */}
        <View className="shrink">{children ?? <Text variant="body">{label}</Text>}</View>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger" className="ml-9" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export type IconTone = "lost" | "found" | "warning" | "violet" | "blue" | "primary" | "neutral" | "danger";

// En oscuro cada tono conserva su color (más luminoso) sobre un fondo translúcido del mismo tono.
const ICON_TONES: Record<IconTone, { bg: string; fg: string; darkFg: string }> = {
  lost: { bg: "#FDECEC", fg: "#E02424", darkFg: "#FF8A8A" },
  found: { bg: "#E0F6F3", fg: "#08807A", darkFg: "#3CD5C4" },
  warning: { bg: "#FEF3E2", fg: "#C2410C", darkFg: "#F5A524" },
  violet: { bg: "#F1ECFE", fg: "#6D4AD6", darkFg: "#B9A2FF" },
  blue: { bg: "#E8F1FE", fg: "#1D6FE0", darkFg: "#7DB4FF" },
  primary: { bg: "#E0F6F3", fg: "#08807A", darkFg: "#3CD5C4" },
  neutral: { bg: "#EEF2F5", fg: "#5D6C80", darkFg: "#C9D6E0" },
  danger: { bg: "#FDECEC", fg: "#C81E1E", darkFg: "#FF6B6B" },
};

/** Ícono dentro de un círculo pastel (listas de ajustes y preferencias de los mockups). */
export function IconBubble({ icon, tone = "primary", size = 44 }: { icon: IconName; tone?: IconTone; size?: number }) {
  const { scheme } = useTheme();
  const palette = ICON_TONES[tone];
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: scheme === "dark" ? `${palette.darkFg}24` : palette.bg }}
    >
      <Icon name={icon} size={size * 0.5} color={scheme === "dark" ? palette.darkFg : palette.fg} />
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onChange,
  icon,
  tone,
  disabled,
  testID,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  icon?: IconName;
  tone?: IconTone;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View className="min-h-[64px] flex-row items-center gap-3 py-3">
      {icon ? <IconBubble icon={icon} tone={tone} /> : null}
      <View className="flex-1">
        <Text variant="bodyStrong">{title}</Text>
        {description ? <Text variant="caption">{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={description}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        testID={testID}
        trackColor={{ false: colors.border, true: colors.primaryStrong }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** Fila navegable de ajustes: ícono, título, descripción, valor y chevron. */
export function ListRow({
  title,
  description,
  value,
  valueTone = "primary",
  icon,
  tone,
  onPress,
  danger,
  testID,
  right,
}: {
  title: string;
  description?: string;
  value?: string;
  valueTone?: "primary" | "muted";
  icon?: IconName;
  tone?: IconTone;
  onPress?: () => void;
  danger?: boolean;
  testID?: string;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[title, description, value].filter(Boolean).join(". ")}
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      className="min-h-[56px] flex-row items-center gap-3 py-3 active:opacity-70"
    >
      {icon ? <IconBubble icon={icon} tone={danger ? "danger" : tone} /> : null}
      <View className="flex-1">
        <Text variant="bodyStrong" tone={danger ? "danger" : "ink"}>
          {title}
        </Text>
        {description ? <Text variant="caption">{description}</Text> : null}
      </View>
      {right}
      {value ? (
        <Text variant="captionStrong" tone={valueTone}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

export function Divider({ className }: { className?: string }) {
  return <View className={cn("h-px bg-border", className)} />;
}

/** Píldora de filtro (Todas / Perdidas / Encontradas). */
export function Chip({
  label,
  selected,
  onPress,
  dotColor,
  icon,
  testID,
  className,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  dotColor?: string;
  icon?: IconName;
  testID?: string;
  className?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      testID={testID}
      className={cn(
        "min-h-[44px] flex-row items-center justify-center gap-2 rounded-full px-4 shadow-sm shadow-black/5 active:opacity-80",
        selected ? "bg-primary-strong" : "border border-border bg-surface",
        className,
      )}
    >
      {icon ? <Icon name={icon} size={16} color={selected ? "#FFFFFF" : colors.ink} /> : null}
      {dotColor ? <View className="h-3 w-3 rounded-full" style={{ backgroundColor: dotColor }} /> : null}
      <Text variant="captionStrong" tone={selected ? "white" : "ink"}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({ children, className, testID }: { children: ReactNode; className?: string; testID?: string }) {
  return (
    <View
      testID={testID}
      className={cn("rounded-3xl border border-border/60 bg-surface p-4 shadow-sm shadow-black/5", className)}
    >
      {children}
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  actionIcon = "chevron-forward",
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: IconName;
}) {
  const { colors } = useTheme();
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          className="min-h-[44px] flex-row items-center gap-1 pl-3 active:opacity-70"
        >
          <Text variant="captionStrong" tone="primary">
            {actionLabel}
          </Text>
          <Icon name={actionIcon} size={16} color={colors.primaryStrong} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View className="items-center px-6 py-10">
      <IconBubble icon={icon} size={72} />
      <Text variant="subheading" className="mt-4 text-center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="muted" className="mt-1 text-center">
          {body}
        </Text>
      ) : null}
      {action ? <View className="mt-5 w-full">{action}</View> : null}
    </View>
  );
}

/** Aviso en línea (información, seguridad, error de red). */
export function Banner({
  icon = "information-circle-outline",
  title,
  body,
  tone = "primary",
  action,
}: {
  icon?: IconName;
  title?: string;
  body: string;
  tone?: "primary" | "warning" | "lost";
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  const color = tone === "warning" ? colors.warning : tone === "lost" ? colors.lostInk : colors.primaryStrong;
  return (
    <View
      accessibilityLiveRegion="polite"
      className={cn(
        "flex-row items-start gap-3 rounded-2xl p-4",
        tone === "warning" ? "bg-warning-soft" : tone === "lost" ? "bg-lost-soft" : "bg-primary-soft",
      )}
    >
      <Icon name={icon} size={22} color={color} />
      <View className="flex-1 gap-0.5">
        {title ? <Text variant="bodyStrong">{title}</Text> : null}
        <Text variant="caption" tone="body">
          {body}
        </Text>
        {action}
      </View>
    </View>
  );
}
