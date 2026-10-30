import { router } from "expo-router";

import { Screen } from "@/components/layout";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Controls";
import { useI18n } from "@/i18n/I18nProvider";

/** Centrado en la pantalla; antes el aviso quedaba arriba y el logo suelto debajo del botón. */
export default function NotFoundScreen() {
  const { t } = useI18n();
  return (
    <Screen scroll={false} contentClassName="justify-center px-6">
      <EmptyState
        icon="compass-outline"
        title={t("common.notFound")}
        action={<Button label={t("common.goHome")} onPress={() => router.replace("/")} />}
      />
    </Screen>
  );
}
