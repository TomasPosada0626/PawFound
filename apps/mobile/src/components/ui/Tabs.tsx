import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./Icon";
import { cn, Text } from "./Text";

export type TabItem<K extends string> = { key: K; label: string; icon?: IconName; iconColor?: string; badge?: boolean };

/** Pestañas con subrayado (Chats / Grupos / Notificaciones). */
export function UnderlineTabs<K extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" className="flex-row border-b border-border">
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(item.key)}
            className="min-h-[52px] flex-1 flex-row items-center justify-center gap-1.5 active:opacity-70"
          >
            {item.icon ? <Icon name={item.icon} size={20} color={selected ? colors.primaryStrong : colors.muted} /> : null}
            <Text variant={selected ? "captionStrong" : "caption"} tone={selected ? "primary" : "muted"} numberOfLines={1}>
              {item.label}
            </Text>
            {item.badge ? <View className="mb-2 h-2 w-2 rounded-full bg-lost" /> : null}
            {selected ? <View className="absolute bottom-0 left-3 right-3 h-[3px] rounded-full bg-primary-strong" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Selector segmentado tipo píldora (Perdida / Encontrada en Reportar). */
export function SegmentedControl<K extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View accessibilityRole="tablist" className="flex-row rounded-full bg-surface p-1 shadow-sm shadow-black/10">
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(item.key)}
            className={cn(
              "min-h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-full active:opacity-80",
              selected && "border-[1.5px] border-primary-strong bg-surface",
            )}
          >
            {item.icon ? <Icon name={item.icon} size={20} color={item.iconColor ?? "#08807A"} /> : null}
            <Text variant="subheading" tone={selected ? (item.key === "lost" ? "lost" : "primary") : "ink"}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
