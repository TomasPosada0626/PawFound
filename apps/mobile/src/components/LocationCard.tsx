import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { regionForRadius } from "@/domain/geo";
import type { LatLng, Message } from "@/domain/types";
import { clockTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { PetMap } from "./map/PetMap";
import { Icon } from "./ui/Icon";
import { cn, Text } from "./ui/Text";

/**
 * Ubicación compartida dentro de una burbuja de chat: mapa pequeño, a qué corresponde (ubicación
 * actual, punto de encuentro o veterinaria), "Cómo llegar" y, para quien la envió, "Dejar de
 * compartir". Cuando ya no es visible solo queda el aviso, sin mapa ni coordenadas.
 */
export function LocationCard({
  message,
  mine,
  onDirections,
  onStop,
}: {
  message: Message;
  mine: boolean;
  onDirections: (target: { destination: LatLng; label?: string }) => void;
  onStop: () => void;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const loc = message.location;
  const point = loc && !loc.hidden ? loc.location : undefined;
  const region = useMemo(() => (point ? regionForRadius(point, 200) : null), [point]);
  if (!loc) return null;

  if (!point || !region) {
    return (
      <View className="min-h-[32px] flex-row items-center gap-2" testID={`location-hidden-${message.id}`}>
        <Icon name="location-outline" size={18} color={mine ? "#FFFFFF" : colors.muted} />
        <Text variant="caption" tone={mine ? "white" : "muted"}>
          {t("chatLocation.hidden")}
        </Text>
      </View>
    );
  }

  const who = message.authorShortName || t("common.deletedUser");
  const title =
    loc.kind === "place"
      ? mine
        ? t("chatLocation.placeMine")
        : t("chatLocation.place", { name: who })
      : loc.kind === "meeting"
        ? t("chatLocation.meeting")
        : mine
          ? t("chatLocation.current")
          : t("chatLocation.currentOf", { name: who });
  const detail = loc.kind === "place" ? [loc.label, loc.address].filter(Boolean).join(" · ") : loc.label;
  const target = { destination: point, label: loc.label };

  return (
    <View className="w-[240px]" testID={`location-${message.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("chatLocation.mapLabel")}. ${t("chatLocation.directions")}`}
        onPress={() => onDirections(target)}
        className="overflow-hidden rounded-2xl"
      >
        <View pointerEvents="none">
          <PetMap
            height={130}
            region={region}
            interactive={false}
            lite
            shareMarker={loc.kind === "place" ? undefined : { coordinate: point, kind: loc.kind }}
            places={
              loc.kind === "place" ? [{ id: loc.placeId ?? message.id, kind: "vet", name: loc.label ?? "", location: point }] : []
            }
            selectedPlaceId={loc.kind === "place" ? (loc.placeId ?? message.id) : undefined}
          />
        </View>
      </Pressable>
      <Text variant="bodyStrong" tone={mine ? "white" : "ink"} className="mt-2">
        {title}
      </Text>
      {detail ? (
        <Text variant="caption" tone={mine ? "white" : "body"} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      <Text variant="label" tone={mine ? "white" : "muted"} className="mt-0.5 opacity-80">
        {t("chatLocation.sentAt", { time: clockTime(new Date(message.at), locale) })}
      </Text>
      <View className="mt-2 flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={() => onDirections(target)}
          className={cn(
            "min-h-[40px] flex-row items-center gap-1.5 rounded-full px-3 active:opacity-80",
            mine ? "bg-white/20" : "bg-primary-soft",
          )}
          testID={`location-directions-${message.id}`}
        >
          <Icon name="navigate" size={16} color={mine ? "#FFFFFF" : colors.primaryStrong} />
          <Text variant="captionStrong" tone={mine ? "white" : "primary"}>
            {t("chatLocation.directions")}
          </Text>
        </Pressable>
        {mine ? (
          <Pressable
            accessibilityRole="button"
            onPress={onStop}
            className="min-h-[40px] flex-row items-center gap-1.5 rounded-full bg-white/20 px-3 active:opacity-80"
            testID={`location-stop-${message.id}`}
          >
            <Icon name="eye-off-outline" size={16} color="#FFFFFF" />
            <Text variant="captionStrong" tone="white">
              {t("chatLocation.stop")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
