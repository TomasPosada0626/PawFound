import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";

import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Card, IconBubble, type IconTone } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { safeNext } from "@/hooks/useAuthGate";
import { useAlertSetup } from "@/hooks/useAlertSetup";
import { useI18n } from "@/i18n/I18nProvider";
import { useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Activar las alertas: dos filas que dicen qué se necesita y por qué, y un solo botón que pide
 * todo. El texto de privacidad va antes de pedir la ubicación, como exige Google Play para el
 * segundo plano. Es opcional (Android y la Ley 1581 exigen un consentimiento libre), pero se dice
 * claro qué se pierde.
 */
export default function AlertsOnboardingScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(params.next);
  const user = useCurrentUser();
  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next } }} />;
  return <AlertsStep userId={user.id} next={next} />;
}

function PermissionRow({
  icon,
  title,
  detail,
  status,
  testID,
}: {
  icon: IconName;
  title: string;
  detail: string;
  status: "pending" | "on" | "partial" | "blocked";
  testID: string;
}) {
  const { colors } = useTheme();
  const tone: IconTone = status === "on" ? "found" : status === "pending" ? "primary" : "warning";
  return (
    <View className="flex-row items-center gap-3" testID={testID} accessible accessibilityLabel={`${title}. ${detail}`}>
      <IconBubble icon={icon} tone={tone} size={48} />
      <View className="flex-1">
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone={status === "pending" || status === "on" ? "muted" : "body"}>
          {detail}
        </Text>
      </View>
      {status === "on" ? <Icon name="checkmark-circle" size={26} color={colors.primaryStrong} /> : null}
    </View>
  );
}

function AlertsStep({ userId, next }: { userId: string; next: string }) {
  const { t } = useI18n();
  const { push, mode, zone, busy, activate } = useAlertSetup(userId);
  const [tried, setTried] = useState(false);
  const leave = () => router.replace(next as never);

  const pushOn = push === "granted";
  const pushBlocked = push === "denied";
  const locationOn = Boolean(zone) && mode === "always";
  const locationPartial = Boolean(zone) && mode === "foreground";
  const locationBlocked = tried && !zone;
  const ready = pushOn && locationOn;
  const needsSettings = pushBlocked || locationPartial || locationBlocked;

  const start = async () => {
    await activate();
    setTried(true);
  };

  return (
    <AuthLayout title={t("alertsOnboarding.title")} subtitle={t("alertsOnboarding.subtitle")} testID="alerts-onboarding">
      <View className="gap-4">
        <Card className="gap-4">
          <PermissionRow
            icon="notifications"
            title={t("alertsOnboarding.pushTitle")}
            detail={
              pushOn ? t("alertsOnboarding.on") : pushBlocked ? t("alertsOnboarding.pushBlocked") : t("alertsOnboarding.pushBody")
            }
            status={pushOn ? "on" : pushBlocked ? "blocked" : "pending"}
            testID="alerts-row-push"
          />
          <PermissionRow
            icon="location"
            title={t("alertsOnboarding.locationTitle")}
            detail={
              locationOn
                ? t("alertsOnboarding.on")
                : locationPartial
                  ? t("alertsOnboarding.locationPartial")
                  : locationBlocked
                    ? t("alertsOnboarding.locationBlocked")
                    : t("alertsOnboarding.locationBody")
            }
            status={locationOn ? "on" : locationPartial ? "partial" : locationBlocked ? "blocked" : "pending"}
            testID="alerts-row-location"
          />
        </Card>

        {ready ? null : (
          <Text variant="caption" tone="body" testID="alerts-privacy">
            {t("alertsOnboarding.privacy")}
          </Text>
        )}
        {needsSettings ? (
          <Text variant="caption" tone="body" accessibilityLiveRegion="polite">
            {locationPartial && !pushBlocked ? t("alertsOnboarding.fixPartial") : t("alertsOnboarding.fixBlocked")}
          </Text>
        ) : null}

        {ready ? (
          <Button label={t("alertsOnboarding.continue")} onPress={leave} testID="alerts-continue" />
        ) : needsSettings ? (
          <Button
            label={t("alertsOnboarding.settings")}
            icon="settings-outline"
            onPress={() => void Linking.openSettings()}
            testID="alerts-settings"
          />
        ) : (
          <Button
            label={t("alertsOnboarding.activate")}
            icon="notifications"
            loading={busy}
            onPress={() => void start()}
            testID="alerts-activate"
          />
        )}

        {ready ? null : (
          <View className="items-center gap-1">
            <Button label={t("alertsOnboarding.later")} variant="ghost" onPress={leave} testID="alerts-continue" />
            <Text variant="caption" className="text-center">
              {t("alertsOff.title")}
            </Text>
          </View>
        )}
      </View>
    </AuthLayout>
  );
}
