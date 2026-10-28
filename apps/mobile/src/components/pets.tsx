import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { formatDistance } from "@/domain/geo";
import type { AvatarId, CaseKind, CaseState, PetCase, User } from "@/domain/types";
import { relativeTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { useDevicePrefs } from "@/store/devicePrefs";
import { useTheme } from "@/theme/ThemeProvider";
import { statusColor } from "@/theme/tokens";

import { Icon, type IconName } from "./ui/Icon";
import { cn, Text } from "./ui/Text";

export function petDisplayName(pet: PetCase, t: (k: "common.unnamed") => string): string {
  return pet.name ?? t("common.unnamed");
}

/** Insignia de estado: color + texto siempre (nunca solo color, docs/accesibilidad.md). */
export function StatusBadge({ kind, state = "active", size = "md" }: { kind: CaseKind; state?: CaseState; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const reunited = state === "reunited";
  return (
    <View
      className={cn(
        "self-start rounded-full",
        size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1",
        reunited ? "bg-navy" : kind === "lost" ? "bg-lost" : "bg-found",
      )}
    >
      <Text variant="label" tone="white">
        {reunited ? t("status.reunited") : kind === "lost" ? t("status.lost") : t("status.found")}
      </Text>
    </View>
  );
}

/** Etiqueta suave "Mascota perdida/encontrada" (listas de grupos y chats). */
export function KindTag({ kind, label }: { kind: CaseKind; label: string }) {
  return (
    <View className={cn("self-start rounded-md px-2 py-0.5", kind === "lost" ? "bg-lost-soft" : "bg-found-soft")}>
      <Text variant="label" tone={kind === "lost" ? "lost" : "found"}>
        {label}
      </Text>
    </View>
  );
}

const SPECIES_ICON: Record<PetCase["species"], IconName> = { dog: "paw", cat: "paw", other: "paw" };

/** Foto de mascota con respaldo (especie sobre fondo suave) si no hay imagen o falla. */
export function PetPhoto({
  pet,
  className,
  rounded = "rounded-2xl",
  label,
}: {
  pet: Pick<PetCase, "photos" | "species" | "kind">;
  className?: string;
  rounded?: string;
  label?: string;
}) {
  const { colors } = useTheme();
  const uri = pet.photos[0];
  return (
    <View
      className={cn("overflow-hidden bg-surface-alt", rounded, className)}
      accessible={Boolean(label)}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
    >
      <View className="absolute inset-0 items-center justify-center">
        <Icon name={SPECIES_ICON[pet.species]} size={32} color={pet.kind === "lost" ? colors.lost : colors.primary} />
      </View>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={200}
          accessible={false}
        />
      ) : null}
    </View>
  );
}

/** Avatar circular de mascota con anillo del color del caso y mini-ícono (chats, notificaciones). */
export function PetAvatar({
  pet,
  size = 64,
  badgeIcon = "people",
}: {
  pet: Pick<PetCase, "photos" | "species" | "kind">;
  size?: number;
  badgeIcon?: IconName | null;
}) {
  const ring = statusColor[pet.kind];
  return (
    <View style={{ width: size, height: size }}>
      <View className="h-full w-full rounded-full p-[3px]" style={{ backgroundColor: ring }}>
        <View className="flex-1 overflow-hidden rounded-full border-2 border-surface">
          <PetPhoto pet={pet} rounded="rounded-full" className="h-full w-full" />
        </View>
      </View>
      {badgeIcon ? (
        <View
          className="absolute -bottom-0.5 -right-0.5 items-center justify-center rounded-full border-2 border-surface"
          style={{ backgroundColor: ring, width: size * 0.38, height: size * 0.38 }}
        >
          <Icon name={badgeIcon} size={size * 0.2} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const AVATARS: Record<AvatarId, { emoji: string; bg: string }> = {
  dog: { emoji: "🐶", bg: "#FDE8C8" },
  cat: { emoji: "🐱", bg: "#E5E0FB" },
  fox: { emoji: "🦊", bg: "#FFE1D6" },
  panda: { emoji: "🐼", bg: "#DDF3EE" },
  bunny: { emoji: "🐰", bg: "#FCE3EE" },
  bear: { emoji: "🐻", bg: "#E6EEF9" },
};

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

export function AvatarGlyph({ avatar, size = 56 }: { avatar: AvatarId; size?: number }) {
  const a = AVATARS[avatar] ?? AVATARS.dog;
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: a.bg }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.66 }} maxFontSizeMultiplier={1}>
        {a.emoji}
      </Text>
    </View>
  );
}

export function UserAvatar({
  user,
  size = 56,
  ring = false,
  online,
}: {
  user: Pick<User, "avatar">;
  size?: number;
  ring?: boolean;
  online?: boolean;
}) {
  return (
    <View style={{ width: size, height: size }}>
      <View className={cn("h-full w-full items-center justify-center rounded-full", ring && "border-[3px] border-primary")}>
        <AvatarGlyph avatar={user.avatar} size={ring ? size - 8 : size} />
      </View>
      {online !== undefined ? (
        <View
          className={cn(
            "absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-surface",
            online ? "bg-[#22C55E]" : "bg-border",
          )}
        />
      ) : null}
    </View>
  );
}

/** Tarjeta del carrusel "Mascotas cerca de ti" (Home y Mapa). */
export function PetCard({ pet, distance, now, width = 172 }: { pet: PetCase; distance?: number; now: Date; width?: number }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { isFavorite, toggleFavorite } = useDevicePrefs();
  const name = petDisplayName(pet, t);
  const subtitle = pet.breed ?? t(`species.${pet.species}`);
  const favorite = isFavorite(pet.id);
  const time = relativeTime(pet.lastSeenAt, now, locale);
  const distanceText = distance !== undefined ? t("time.distanceAway", { distance: formatDistance(distance, locale) }) : null;
  const status = pet.kind === "lost" ? t("status.lost") : t("status.found");

  return (
    <View style={{ width }} className="overflow-hidden rounded-3xl border border-border/60 bg-surface shadow-sm shadow-black/10">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[name, subtitle, status, distanceText, time].filter(Boolean).join(", ")}
        onPress={() => router.push(`/pet/${pet.id}`)}
        className="active:opacity-90"
        testID={`pet-card-${pet.id}`}
      >
        <PetPhoto pet={pet} rounded="rounded-none" className="h-32 w-full" />
        <View className="absolute left-2 top-2">
          <StatusBadge kind={pet.kind} />
        </View>
        <View className="gap-0.5 p-3 pr-2">
          <Text variant="subheading" numberOfLines={1} className="pr-10">
            {name}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
          {distanceText ? (
            <View className="mt-1 flex-row items-center gap-1">
              <Icon name="location" size={13} color={colors.primaryStrong} />
              <Text variant="caption" tone="body" numberOfLines={1}>
                {distanceText}
              </Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-1">
            <Icon name="time-outline" size={13} color={colors.muted} />
            <Text variant="caption" numberOfLines={1}>
              {time}
            </Text>
          </View>
        </View>
      </Pressable>
      {/* Área táctil propia para el favorito: no dispara la navegación (docs/flujos/mapa-e-inicio.md §4). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={favorite ? t("common.unfollowCase", { name }) : t("common.followCase", { name })}
        accessibilityState={{ selected: favorite }}
        onPress={() => toggleFavorite(pet.id)}
        className="absolute right-0 top-[124px] h-12 w-12 items-center justify-center"
        testID={`favorite-${pet.id}`}
      >
        <Icon name={favorite ? "heart" : "heart-outline"} size={22} color={favorite ? colors.lost : colors.ink} />
      </Pressable>
    </View>
  );
}

/** Fila de lista (vista "Ver lista", Mis reportes, Siguiendo). */
export function PetRow({ pet, distance, now }: { pet: PetCase; distance?: number; now: Date }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const name = petDisplayName(pet, t);
  const subtitle = pet.breed ?? t(`species.${pet.species}`);
  const time = relativeTime(pet.lastSeenAt, now, locale);
  const distanceText = distance !== undefined ? formatDistance(distance, locale) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, subtitle, pet.zone, distanceText, time].filter(Boolean).join(", ")}
      onPress={() => router.push(`/pet/${pet.id}`)}
      className="min-h-[88px] flex-row items-center gap-3 rounded-3xl border border-border/60 bg-surface p-3 active:opacity-80"
      testID={`pet-row-${pet.id}`}
    >
      <PetPhoto pet={pet} className="h-20 w-20" />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text variant="subheading" numberOfLines={1} className="shrink">
            {name}
          </Text>
          <StatusBadge kind={pet.kind} state={pet.state} size="sm" />
        </View>
        <Text variant="caption" numberOfLines={1}>
          {subtitle}
        </Text>
        <View className="flex-row items-center gap-1">
          <Icon name="location-outline" size={13} color={colors.primaryStrong} />
          <Text variant="caption" tone="body" numberOfLines={1} className="shrink">
            {distanceText ? `${pet.zone} · ${distanceText}` : pet.zone}
          </Text>
        </View>
        <Text variant="caption">{time}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
