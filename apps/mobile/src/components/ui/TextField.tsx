import { forwardRef, useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { Icon, type IconName } from "./Icon";
import { cn, Text } from "./Text";

export type TextFieldProps = Omit<TextInputProps, "placeholder" | "className"> & {
  label: string;
  icon?: IconName;
  error?: string;
  hint?: string;
  /** Muestra el botón de ojo para mostrar/ocultar (contraseñas). */
  secureToggle?: boolean;
  /** Placeholder cuando difiere del label (p. ej. ayuda dentro de un textarea). */
  placeholderText?: string;
  showCounter?: boolean;
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * Campo con label real (docs/accesibilidad.md): el label se ve como placeholder cuando
 * está vacío y sube como etiqueta cuando hay valor, sin depender solo del placeholder.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    icon,
    error,
    hint,
    secureToggle,
    placeholderText,
    showCounter,
    trailing,
    className,
    value,
    multiline,
    maxLength,
    onFocus,
    onBlur,
    secureTextEntry,
    ...rest
  },
  ref,
) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const filled = Boolean(value && value.length > 0);
  const showLabel = filled || focused || Boolean(placeholderText);

  return (
    <View className={className}>
      <View
        className={cn(
          "flex-row rounded-2xl border-[1.5px] bg-surface px-4",
          multiline ? "min-h-[120px] items-start py-3" : "min-h-[56px] items-center",
          error ? "border-danger" : focused ? "border-primary-strong" : "border-border",
        )}
      >
        {icon ? (
          <View className={cn("mr-3", multiline && "mt-1")}>
            <Icon name={icon} size={20} color={error ? colors.danger : colors.primaryStrong} />
          </View>
        ) : null}
        <View className="flex-1 justify-center py-1">
          {showLabel ? (
            <Text variant="label" tone={error ? "danger" : "muted"} importantForAccessibility="no" accessibilityElementsHidden>
              {label}
            </Text>
          ) : null}
          <TextInput
            ref={ref}
            value={value}
            accessibilityLabel={label}
            accessibilityHint={hint}
            placeholder={showLabel ? placeholderText : label}
            placeholderTextColor={colors.muted}
            secureTextEntry={secureToggle ? hidden : secureTextEntry}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            multiline={multiline}
            maxLength={maxLength}
            textAlignVertical={multiline ? "top" : "center"}
            maxFontSizeMultiplier={1.6}
            className={cn("font-regular text-[15px] text-ink", multiline ? "min-h-[80px]" : "min-h-[24px]")}
            style={{ paddingVertical: 2 }}
            {...rest}
          />
        </View>
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? t("auth.showPassword") : t("auth.hidePassword")}
            accessibilityState={{ checked: !hidden }}
            onPress={() => setHidden((h) => !h)}
            hitSlop={6}
            className="-mr-1 min-h-[48px] flex-row items-center gap-1.5 rounded-full px-2 active:opacity-70"
            testID={rest.testID ? `${rest.testID}-toggle` : undefined}
          >
            <View className="flex-row items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5">
              <Icon name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={colors.primaryStrong} />
              <Text variant="captionStrong" tone="primary">
                {hidden ? t("auth.show") : t("auth.hide")}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {trailing}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" className="ml-1 mt-1" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint || (showCounter && maxLength) ? (
        <View className="ml-1 mt-1 flex-row justify-between">
          <Text variant="caption" className="flex-1">
            {hint ?? ""}
          </Text>
          {showCounter && maxLength ? <Text variant="caption">{`${value?.length ?? 0}/${maxLength}`}</Text> : null}
        </View>
      ) : null}
    </View>
  );
});
