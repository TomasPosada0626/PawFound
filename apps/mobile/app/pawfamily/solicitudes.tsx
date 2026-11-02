import { Redirect, router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { Screen } from "@/components/layout";
import { AdoptionCard, PawFamilyHeader } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { useI18n } from "@/i18n/I18nProvider";
import { adoptionView } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

/** Las solicitudes para adoptar que envió la cuenta, con su estado. */
export default function MyApplicationsScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const userId = user?.id;

  useEffect(() => {
    if (userId) void backend.loadMyApplications().catch(() => {});
  }, [backend, userId, state.adoptionVersion]);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/pawfamily/solicitudes" } }} />;
  const mine = state.adoptionApplications.filter((a) => a.applicantId === user.id);

  return (
    <Screen header={<PawFamilyHeader back title={t("pawfamily.myRequests")} />} testID="my-applications">
      {mine.length === 0 ? (
        <EmptyState
          icon="paper-plane-outline"
          title={t("pawfamily.myRequestsEmpty")}
          action={<Button label={t("pawfamily.browse")} onPress={() => router.replace("/pawfamily")} />}
        />
      ) : (
        mine.map((application) => {
          const adoption = adoptionView(state, application.adoptionId);
          return (
            <View key={application.id} className="mb-2" testID={`my-application-${application.id}`}>
              {adoption ? <AdoptionCard adoption={adoption} /> : null}
              <View className="-mt-2 mb-2 ml-2 flex-row items-center gap-3">
                <Text variant="captionStrong" tone={application.status === "accepted" ? "primary" : "body"}>
                  {t(`pawfamily.app_${application.status}`)}
                </Text>
                {application.status === "accepted" && application.threadId ? (
                  <Button
                    compact
                    variant="outline"
                    label={t("pawfamily.openChat")}
                    onPress={() => router.push(`/chat/${application.threadId}`)}
                  />
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </Screen>
  );
}
