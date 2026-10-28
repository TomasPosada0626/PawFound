import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Share, View } from "react-native";

import { LogoMark } from "@/components/brand";
import { Screen } from "@/components/layout";
import { PetRow, petDisplayName } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Card, IconBubble } from "@/components/ui/Controls";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { SHARE_BASE_URL } from "@/config";
import { findPossibleMatches } from "@/domain/rules";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useBackendState } from "@/store/backend";

/** Confirmación + coincidencias + próximos pasos: lo que más acelera un reencuentro. */
export default function ReportSuccessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const now = useNow();
  const toast = useToast();
  const pet = state.pets.find((p) => p.id === id);
  const matches = useMemo(() => (pet ? findPossibleMatches(pet, state.pets, now) : []), [pet, state.pets, now]);

  if (!pet) return <Redirect href="/" />;
  const name = petDisplayName(pet, t);
  const isLost = pet.kind === "lost";

  const share = async () => {
    const result = await Share.share({
      message: t("pet.shareMessage", {
        status: (isLost ? t("status.lost") : t("status.found")).toUpperCase(),
        name,
        species: t(`speciesLower.${pet.species}`),
        zone: pet.zone,
        url: `${SHARE_BASE_URL}${pet.id}`,
      }),
    });
    if (result.action !== Share.dismissedAction) {
      await backend.sharePet(pet.id);
      toast(t("pet.shared"));
    }
  };

  return (
    <Screen testID="report-success">
      <View className="items-center pt-8">
        <LogoMark size={88} />
        <Text variant="title" className="mt-4 text-center" accessibilityRole="header" accessibilityLiveRegion="polite">
          {isLost ? t("report.successTitleLost") : t("report.successTitleFound")}
        </Text>
        <Text variant="body" tone="muted" className="mt-1 text-center">
          {isLost ? t("report.successBodyLost", { name }) : t("report.successBodyFound")}
        </Text>
      </View>

      <View className="mt-6">
        <Text variant="heading" accessibilityRole="header">
          {isLost ? t("report.matchesTitleLost") : t("report.matchesTitle")}
        </Text>
        <View className="mt-3 gap-3" testID="success-matches">
          {matches.length === 0 ? (
            <Text variant="caption">{t("report.noMatches")}</Text>
          ) : (
            matches.map((m) => <PetRow key={m.pet.id} pet={m.pet} distance={m.distance} now={now} />)
          )}
        </View>
      </View>

      <Card className="mt-6">
        <Text variant="subheading" accessibilityRole="header" className="mb-2">
          {t("report.nextSteps")}
        </Text>
        <Step icon="share-social-outline" text={t("report.stepShare")} />
        <Step icon="people-outline" text={t("report.stepGroup")} />
        <Step icon="medkit-outline" text={t("report.stepVets")} />
      </Card>

      <View className="mt-6 gap-3">
        <Button label={t("common.share")} icon="share-social" onPress={() => void share()} testID="success-share" />
        <Button
          label={t("report.openGroup")}
          icon="people"
          variant="outline"
          onPress={() => router.replace(`/chat/${pet.groupId}`)}
        />
        <Button
          label={t("report.viewReport")}
          variant="ghost"
          onPress={() => router.replace(`/pet/${pet.id}`)}
          testID="success-view"
        />
      </View>
    </Screen>
  );
}

function Step({ icon, text }: { icon: "share-social-outline" | "people-outline" | "medkit-outline"; text: string }) {
  return (
    <View className="flex-row items-center gap-3 py-2">
      <IconBubble icon={icon} size={40} />
      <Text variant="body" className="flex-1">
        {text}
      </Text>
    </View>
  );
}
