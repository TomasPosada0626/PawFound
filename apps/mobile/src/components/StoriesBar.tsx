import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { useSeenStories } from "@/hooks/useSeenStories";
import { useI18n } from "@/i18n/I18nProvider";
import { storyFeed, storySlideIds } from "@/services/selectors";
import { useBackend, useBackendState } from "@/store/backend";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";

import { Icon } from "./ui/Icon";
import { Text } from "./ui/Text";

const RING = { lost: ["#F06277", "#C8283D"], found: ["#2BC4A6", "#0E7C6B"] } as const;

/**
 * Fila de historias (Inicio): los casos activos cerca, como en las redes, pero sin vencer a las
 * 24 horas. El anillo de color indica que hay algo nuevo; gris, que ya se vio todo.
 */
export function StoriesBar({ now }: { now: Date }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const state = useBackendState();
  const backend = useBackend();
  const { location } = useUserLocation();
  useEffect(() => {
    void backend.loadStories(location).catch(() => {});
  }, [backend, location]);
  const { seen } = useSeenStories();
  const feed = useMemo(() => storyFeed(state, location, now), [state, location, now]);
  if (!feed.length) return null;

  return (
    <View className="mt-5" testID="stories-bar">
      <Text variant="subheading" accessibilityRole="header" className="mb-2">
        {t("stories.title")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 8 }}>
        {feed.map(({ pet, items }) => {
          const unseen = storySlideIds(pet, items).some((id) => !seen.has(id));
          const name = pet.name ?? t(pet.kind === "lost" ? "stories.lost" : "stories.found");
          return (
            <Pressable
              key={pet.id}
              accessibilityRole="button"
              accessibilityLabel={`${t("stories.view", { name })}${unseen ? `. ${t("stories.new")}` : ""}`}
              onPress={() => router.push(`/historias/${pet.id}`)}
              className="w-[76px] items-center gap-1 active:opacity-80"
              testID={`story-${pet.id}`}
            >
              <LinearGradient
                colors={unseen ? RING[pet.kind] : [colors.border, colors.border]}
                style={{ width: 74, height: 74, borderRadius: 37, alignItems: "center", justifyContent: "center" }}
              >
                <View
                  style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: colors.bg }}
                  className="items-center justify-center"
                >
                  {pet.photos[0] ? (
                    <Image
                      source={{ uri: pet.photos[0] }}
                      style={{ width: 60, height: 60, borderRadius: 30 }}
                      contentFit="cover"
                      accessible={false}
                    />
                  ) : (
                    <Icon name="paw" size={28} color={colors.primaryStrong} />
                  )}
                </View>
              </LinearGradient>
              <Text variant="caption" numberOfLines={1} className="text-center" tone={unseen ? "body" : "muted"}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
