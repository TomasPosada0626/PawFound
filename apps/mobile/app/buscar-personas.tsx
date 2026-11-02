import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PersonRow } from "@/components/PersonRow";
import { EmptyState } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import type { User } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend } from "@/store/backend";

const MIN_LETTERS = 3;
const TYPING_PAUSE_MS = 300;

/** Buscar personas por nombre de usuario. El @ es opcional: se quita si la persona lo escribe. */
export default function SearchPeopleScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[] | null>(null);
  const clean = query.trim().replace(/^@/, "");
  const ready = clean.length >= MIN_LETTERS;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const timer = setTimeout(() => {
      backend
        .searchUsers(clean)
        .then((list) => {
          if (live) setResults(list);
        })
        .catch(() => {
          if (live) setResults([]);
        });
    }, TYPING_PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [backend, clean, ready]);

  return (
    <Screen header={<AppHeader left={<BackButton />} title={t("network.search")} />} testID="search-people">
      <TextField
        label={t("network.searchLabel")}
        icon="search-outline"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        hint={t("network.searchHint")}
        testID="search-people-input"
      />
      <View className="mt-3">
        {!ready ? null : results === null ? (
          <Text variant="caption">{t("network.searching")}</Text>
        ) : results.length === 0 ? (
          <EmptyState icon="search-outline" title={t("network.searchEmpty")} />
        ) : (
          results.map((person) => <PersonRow key={person.id} person={person} />)
        )}
      </View>
    </Screen>
  );
}
