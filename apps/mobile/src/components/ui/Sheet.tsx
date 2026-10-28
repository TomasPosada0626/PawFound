import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { cn, Text } from "./Text";

/** Hoja inferior modal. El botón Atrás de Android la cierra (onRequestClose). */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          className="absolute inset-0 bg-black/40"
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          className="max-h-[88%] rounded-t-[28px] bg-surface px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-2 h-1.5 w-12 self-center rounded-full bg-border" />
          {title ? (
            <View className="mb-3 flex-row items-start justify-between gap-3">
              <View className="flex-1 pt-2">
                <Text variant="heading" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
              </View>
              <IconButton icon="close" label={t("common.close")} onPress={onClose} />
            </View>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export type Option<V extends string | number> = { value: V; label: string; description?: string; icon?: IconName };

/** Lista de opciones de selección única (radio) dentro de una hoja. */
export function OptionList<V extends string | number>({
  options,
  value,
  onSelect,
}: {
  options: Option<V>[];
  value: V | null | undefined;
  onSelect: (value: V) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" className="pb-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.description ? `${option.label}. ${option.description}` : option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onSelect(option.value)}
            className={cn(
              "mb-2 min-h-[56px] flex-row items-center gap-3 rounded-2xl border px-4 py-3 active:opacity-80",
              selected ? "border-primary-strong bg-primary-soft" : "border-border bg-surface",
            )}
          >
            {option.icon ? <Icon name={option.icon} size={22} color={selected ? colors.primaryStrong : colors.muted} /> : null}
            <View className="flex-1">
              <Text variant="bodyStrong">{option.label}</Text>
              {option.description ? <Text variant="caption">{option.description}</Text> : null}
            </View>
            <Icon
              name={selected ? "radio-button-on" : "radio-button-off"}
              size={22}
              color={selected ? colors.primaryStrong : colors.muted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Confirmación destructiva o importante, en hoja (Alert no es fiable en web ni testeable). */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
  loading,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      <Text variant="body" className="mb-5">
        {body}
      </Text>
      <View className="gap-3 pb-2">
        <Button label={confirmLabel} variant={danger ? "danger" : "primary"} onPress={onConfirm} loading={loading} />
        <Button label={t("common.cancel")} variant="ghost" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
