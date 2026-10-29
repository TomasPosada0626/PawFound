import { Redirect, router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { AlertsOffBanner, useAlertsGap } from "@/components/AlertsOffBanner";
import { AngelAlertSettings } from "@/components/AngelAlertSettings";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Controls";
import { safeNext } from "@/hooks/useAuthGate";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useCurrentUser } from "@/store/backend";

/**
 * Paso del registro, justo después de verificar el celular: activar las notificaciones y la
 * zona de alertas, que es lo que hace llegar las Alertas Ángel. Decisión de producto: se
 * pueden desactivar (Apple y Android exigen que el permiso sea opcional, y la Ley 1581 que el
 * consentimiento sea libre), pero un letrero deja claro que así no llegan las alertas de
 * mascotas perdidas, aquí y en Inicio hasta que se activen.
 */
export default function AlertsOnboardingScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const user = useCurrentUser();
  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next } }} />;
  return <AlertsStep userId={user.id} next={next} />;
}

function AlertsStep({ userId, next }: { userId: string; next: string }) {
  const { t } = useI18n();
  const backend = useBackend();
  const gap = useAlertsGap(userId);
  return (
    <AuthLayout title={t("alertsOnboarding.title")} subtitle={t("alertsOnboarding.subtitle")} testID="alerts-onboarding">
      <View className="gap-4">
        <Banner icon="gift-outline" body={t("alertsOnboarding.free")} />
        <AngelAlertSettings prefs={backend.notificationPrefsFor(userId)} userId={userId} />
        <AlertsOffBanner userId={userId} showAction={false} />
        <Button
          label={gap ? t("alertsOnboarding.continueWithout") : t("alertsOnboarding.continue")}
          variant={gap ? "ghost" : "primary"}
          onPress={() => router.replace(next as never)}
          testID="alerts-continue"
        />
      </View>
    </AuthLayout>
  );
}
