import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { shortName } from "@/domain/privacy";
import type { User } from "@/domain/types";

import { UserAvatar } from "./pets";
import { Text } from "./ui/Text";

/** Fila de una persona: al tocarla abre su perfil. `children` son sus acciones. */
export function PersonRow({ person, children }: { person: User; children?: ReactNode }) {
  const name = shortName(person.name);
  return (
    <View className="flex-row items-center gap-3 border-b border-border py-3" testID={`person-${person.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, @${person.username}`}
        onPress={() => router.push(`/user/${person.id}`)}
        className="min-h-[48px] flex-1 flex-row items-center gap-3 active:opacity-70"
      >
        <UserAvatar user={person} size={48} />
        <View className="shrink">
          <Text variant="bodyStrong" numberOfLines={1}>
            {name}
          </Text>
          {person.username ? <Text variant="caption" numberOfLines={1}>{`@${person.username}`}</Text> : null}
        </View>
      </Pressable>
      {children}
    </View>
  );
}
