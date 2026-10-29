import { router } from "expo-router";

import { LogoMark } from "@/components/brand";
import { Screen } from "@/components/layout";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Controls";
import { useI18n } from "@/i18n/I18nProvider";

export default function NotFoundScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <EmptyState
        icon="compass-outline"
        title={t("common.notFound")}
        action={<Button label={t("common.goHome")} onPress={() => router.replace("/")} />}
      />
      <LogoMark size={64} />
    </Screen>
  );
}
