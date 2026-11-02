import { router } from "expo-router";
import { Pressable, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from "react-native-svg";

import type { Adoption } from "@/domain/adoption";
import { formatDistance } from "@/domain/geo";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackendState } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

import { LogoMark } from "./brand";
import { PetPhoto } from "./pets";
import { Icon } from "./ui/Icon";
import { Text } from "./ui/Text";

/** Teal de la marca: PawFamily es una sección de PawFound, no otra marca. */
const BRAND_TEAL = "#12B3A6";

/**
 * Ícono del botón de PawFamily en Inicio: el pin con huella en coral y un corazón. Dentro de la
 * sección se usa el logo de PawFound (`PawFamilyHeader`).
 */
export function PawFamilyMark({ size = 72 }: { size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size * 1.18} viewBox="0 0 100 118">
        <Defs>
          <LinearGradient id="pawfamily" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FF9A7A" />
            <Stop offset="1" stopColor="#D63A62" />
          </LinearGradient>
        </Defs>
        <Ellipse cx="50" cy="112" rx="22" ry="4" fill="#C42D52" opacity={0.18} />
        <Path
          d="M50 2C24.6 2 4 22.2 4 47.2c0 27.6 29.5 50.7 41.5 60.6a7 7 0 0 0 9 0C66.5 97.9 96 74.8 96 47.2 96 22.2 75.4 2 50 2z"
          fill="url(#pawfamily)"
        />
        <Ellipse cx="31" cy="34" rx="7.5" ry="10" fill="#FFFFFF" />
        <Ellipse cx="44.5" cy="24" rx="7.5" ry="10.5" fill="#FFFFFF" />
        <Ellipse cx="58.5" cy="24" rx="7.5" ry="10.5" fill="#FFFFFF" />
        <Ellipse cx="71" cy="34" rx="7.5" ry="10" fill="#FFFFFF" />
        <Path
          d="M51 80c-2-2-19-12-19-23 0-6 4.5-10 9.5-10 4 0 7 2.5 9.5 6 2.5-3.5 5.5-6 9.5-6 5 0 9.5 4 9.5 10 0 11-17 21-19 23z"
          fill="#FFFFFF"
        />
      </Svg>
    </View>
  );
}

/** "PawFamily": "Paw" en tinta y "Family" en el teal de la marca, como "PawFound". */
export function PawFamilyWordmark({ size = 24 }: { size?: number }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="PawFamily">
      <Text variant="display" tone="ink" style={{ fontSize: size, lineHeight: size * 1.2 }} maxFontSizeMultiplier={1.2}>
        Paw
        <Text variant="display" style={{ fontSize: size, lineHeight: size * 1.2, color: BRAND_TEAL }} maxFontSizeMultiplier={1.2}>
          Family
        </Text>
      </Text>
    </View>
  );
}

/** Logo de PawFound con el nombre de la sección, para dejar claro que se está en PawFamily. */
export function PawFamilyBrand({ size = 22 }: { size?: number }) {
  const { t } = useI18n();
  return (
    <View className="flex-row items-center gap-2">
      <LogoMark size={size * 1.3} />
      <View>
        <PawFamilyWordmark size={size} />
        <Text variant="label" tone="muted" style={{ marginTop: -2 }}>
          {t("pawfamily.byPawFound")}
        </Text>
      </View>
    </View>
  );
}

/** Encabezado de PawFamily: logo y un botón claro para volver a PawFound o a la vista anterior. */
export function PawFamilyHeader({ title, back }: { title?: string; back?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View className="px-4 pb-1 pt-2">
      <View className="min-h-[52px] flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={back ? t("common.back") : t("pawfamily.backToPawFound")}
          onPress={() => (back && router.canGoBack() ? router.back() : router.replace("/"))}
          className="min-h-[48px] min-w-[64px] flex-row items-center gap-1 pr-2 active:opacity-70"
          testID={back ? "pawfamily-back" : "back-to-pawfound"}
        >
          <Icon name="chevron-back" size={22} color={colors.ink} />
          {back ? null : <Text variant="captionStrong">PawFound</Text>}
        </Pressable>
        <PawFamilyBrand />
        <View className="min-w-[64px]" />
      </View>
      {title ? (
        <Text variant="title" className="mt-1 text-center" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
    </View>
  );
}

/** Refugio verificado con un NIT válido. */
export function ShelterTag() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-primary-soft px-3 py-1" testID="shelter-tag">
      <Icon name="shield-checkmark" size={14} color={colors.primaryStrong} />
      <Text variant="captionStrong" tone="primary">
        {t("pawfamily.shelterTag")}
      </Text>
    </View>
  );
}

/** Tarjeta de la lista de adopción: todo lo que hace falta para decidir sin abrir la ficha. */
export function AdoptionCard({ adoption, distanceMeters }: { adoption: Adoption; distanceMeters?: number }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const state = useBackendState();
  const owner = state.users[adoption.ownerId];
  const shelter = owner?.shelterStatus === "verified";
  const facts = [t(`sex.${adoption.sex}`), t(`ageShort.${adoption.age}`), t(`size.${adoption.size}`)];
  const health = [
    adoption.vaccinated ? t("pawfamily.vaccinatedShort") : null,
    adoption.sterilized ? t("pawfamily.sterilizedShort") : null,
  ].filter((h): h is string => Boolean(h));
  const place = distanceMeters !== undefined ? `${formatDistance(distanceMeters, locale)} · ${adoption.zone}` : adoption.zone;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[adoption.name, ...facts, ...health, place, shelter ? t("pawfamily.shelterTag") : null]
        .filter(Boolean)
        .join(", ")}
      onPress={() => router.push(`/pawfamily/${adoption.id}`)}
      className="mb-3 gap-3 rounded-3xl border border-border/60 bg-surface p-3 active:opacity-80"
      testID={`adoption-${adoption.id}`}
    >
      <View className="flex-row gap-3">
        <View>
          <PetPhoto pet={adoption} className="h-28 w-28" rounded="rounded-2xl" />
          {adoption.photos.length > 1 ? (
            <View className="absolute bottom-1.5 right-1.5 flex-row items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5">
              <Icon name="images-outline" size={11} color="#FFFFFF" />
              <Text variant="label" style={{ color: "#FFFFFF" }}>
                {String(adoption.photos.length)}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text variant="subheading" numberOfLines={1} className="shrink">
              {adoption.name}
            </Text>
            {adoption.status !== "available" ? (
              <View className="rounded-full bg-surface-alt px-2 py-0.5">
                <Text variant="label">{t(`pawfamily.status_${adoption.status}`)}</Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption" tone="body" numberOfLines={1}>
            {[t(`species.${adoption.species}`), adoption.breed].filter(Boolean).join(" · ")}
          </Text>
          <View className="flex-row flex-wrap gap-1">
            {facts.map((fact) => (
              <View key={fact} className="rounded-full bg-surface-alt px-2 py-0.5">
                <Text variant="label">{fact}</Text>
              </View>
            ))}
          </View>
          {health.length ? (
            <View className="flex-row items-center gap-1">
              <Icon name="medkit-outline" size={13} color={colors.primaryStrong} />
              <Text variant="caption" tone="primary">
                {health.join(" · ")}
              </Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-1">
            <Icon name="location-outline" size={13} color={colors.muted} />
            <Text variant="caption" numberOfLines={1} className="shrink">
              {place}
            </Text>
          </View>
        </View>
      </View>
      {adoption.description ? (
        <Text variant="caption" tone="body" numberOfLines={2}>
          {adoption.description}
        </Text>
      ) : null}
      {shelter && owner?.shelterName ? (
        <View className="flex-row items-center gap-2">
          <ShelterTag />
          <Text variant="caption" numberOfLines={1} className="shrink">
            {owner.shelterName}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
