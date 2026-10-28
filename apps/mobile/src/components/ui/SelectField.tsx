import { useState } from "react";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./Icon";
import { OptionList, Sheet, type Option } from "./Sheet";
import { cn, Text } from "./Text";

/** Campo desplegable (Género, Edad, Tamaño, Tipo de mascota…) que abre una hoja con opciones. */
export function SelectField<V extends string | number>({
  label,
  value,
  options,
  onChange,
  icon,
  error,
  testID,
  compact,
  sheetSubtitle,
}: {
  label: string;
  value: V | null | undefined;
  options: Option<V>[];
  onChange: (value: V) => void;
  icon?: IconName;
  error?: string;
  testID?: string;
  compact?: boolean;
  sheetSubtitle?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View className="flex-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? `${label}: ${selected.label}` : label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        testID={testID}
        className={cn(
          "min-h-[56px] flex-row items-center rounded-2xl border-[1.5px] bg-surface active:opacity-80",
          compact ? "gap-1.5 px-3" : "gap-3 px-4",
          error ? "border-danger" : "border-border",
        )}
      >
        {icon ? <Icon name={icon} size={compact ? 18 : 20} color={error ? colors.danger : colors.primaryStrong} /> : null}
        <View className="flex-1">
          {selected ? (
            <>
              <Text variant="label" tone="muted" numberOfLines={1}>
                {label}
              </Text>
              <Text variant={compact ? "caption" : "body"} tone="ink" numberOfLines={1}>
                {selected.label}
              </Text>
            </>
          ) : (
            <Text variant={compact ? "caption" : "body"} tone="muted" numberOfLines={1}>
              {label}
            </Text>
          )}
        </View>
        <Icon name="chevron-down" size={18} color={colors.ink} />
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger" className="ml-1 mt-1" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label} subtitle={sheetSubtitle}>
        <OptionList
          options={options}
          value={value}
          onSelect={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </Sheet>
    </View>
  );
}
