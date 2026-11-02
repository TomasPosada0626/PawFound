import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Screen } from "@/components/layout";
import { AdoptionCard, PawFamilyHeader } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner, EmptyState } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { useI18n } from "@/i18n/I18nProvider";
import { adoptionView } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

/** Lo que la cuenta publicó en PawFamily, con las solicitudes por responder. */
export default function MyAdoptionsScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const [ids, setIds] = useState<string[] | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    backend
      .loadMyAdoptions()
      .then((list) => {
        if (live) setIds(list);
      })
      .catch(() => {
        if (live) setIds([]);
      });
    return () => {
      live = false;
    };
  }, [backend, userId, state.adoptionVersion]);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/pawfamily/mias" } }} />;
  const list = (ids ?? []).map((id) => adoptionView(state, id)).filter((a) => a !== undefined);

  return (
    <Screen header={<PawFamilyHeader back title={t("pawfamily.mine")} />} testID="my-adoptions">
      <View className="mb-3">
        <Banner icon="mail-outline" body={t("pawfamily.spamNote")} />
      </View>
      {ids !== null && list.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          title={t("pawfamily.mineEmpty")}
          action={<Button label={t("pawfamily.publish")} onPress={() => router.push("/pawfamily/publicar")} />}
        />
      ) : (
        list.map((adoption) => (
          <View key={adoption.id}>
            <AdoptionCard adoption={adoption} />
            {adoption.pending ? (
              <Text variant="captionStrong" tone="primary" className="-mt-2 mb-3 ml-2">
                {t("pawfamily.pendingCount", { count: adoption.pending })}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </Screen>
  );
}
