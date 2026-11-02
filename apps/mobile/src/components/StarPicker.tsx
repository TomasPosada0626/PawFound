import { Pressable, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";

import { Icon } from "./ui/Icon";

const STARS = [1, 2, 3, 4, 5];

/** Calificación de 1 a 5 estrellas al cerrar un caso. */
export function StarPicker({
  value,
  onChange,
  label,
  testID,
}: {
  value: number;
  onChange: (stars: number) => void;
  label: string;
  testID?: string;
}) {
  const { t } = useI18n();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row">
      {STARS.map((stars) => (
        <Pressable
          key={stars}
          accessibilityRole="radio"
          accessibilityLabel={t("pet.starLabel", { count: stars })}
          accessibilityState={{ selected: stars === value }}
          onPress={() => onChange(stars)}
          className="h-12 w-12 items-center justify-center active:opacity-70"
          testID={testID ? `${testID}-${stars}` : undefined}
        >
          <Icon name={stars <= value ? "star" : "star-outline"} size={28} color="#F5A524" />
        </Pressable>
      ))}
    </View>
  );
}
