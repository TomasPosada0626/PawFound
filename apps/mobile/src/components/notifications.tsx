import { router } from "expo-router";
import { Pressable, View } from "react-native";

import type { AppNotification, PetCase } from "@/domain/types";
import { relativeTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

import { PetAvatar, PetPhoto, petDisplayName } from "./pets";
import { Icon } from "./ui/Icon";
import { cn, Text } from "./ui/Text";

const LOST_TONE = new Set<AppNotification["kind"]>(["lost_nearby", "case_update", "comment", "sighting", "case_closed"]);

/** Fila de notificación (pestaña Notificaciones y "Actividad reciente" de Inicio). */
export function NotificationRow({ notification, pet, now }: { notification: AppNotification; pet: PetCase; now: Date }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const name = petDisplayName(pet, t);
  const isLostTone = pet.kind === "lost" && LOST_TONE.has(notification.kind);
  const title = t(`notifications.${notification.kind}`);
  const body = t(`notifications.body_${notification.kind}`, { name });
  const time = relativeTime(notification.at, now, locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${notification.read ? "" : "• "}${title}. ${body}. ${pet.zone}. ${time}`}
      onPress={() => {
        void backend.markNotificationRead(notification.id);
        router.push(`/pet/${pet.id}`);
      }}
      className="min-h-[92px] flex-row items-center gap-3 rounded-3xl border border-border/60 bg-surface p-3 active:opacity-80"
      testID={`notification-${notification.id}`}
    >
      <PetAvatar pet={pet} size={60} />
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" tone={isLostTone ? "lost" : "found"} numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" tone="body" numberOfLines={2}>
          {body}
        </Text>
        <View className="flex-row items-center gap-1">
          <Icon name="location-outline" size={13} color={colors.muted} />
          <Text variant="caption" numberOfLines={1}>
            {pet.zone}
          </Text>
        </View>
      </View>
      <View className="items-end gap-2">
        <View className="flex-row items-center gap-1.5">
          <Text variant="caption">{time}</Text>
          {!notification.read ? <View className={cn("h-2.5 w-2.5 rounded-full", isLostTone ? "bg-lost" : "bg-primary")} /> : null}
        </View>
        <PetPhoto pet={pet} className="h-12 w-12" rounded="rounded-xl" />
      </View>
    </Pressable>
  );
}
