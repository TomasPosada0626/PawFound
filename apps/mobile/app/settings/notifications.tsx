import { Redirect } from "expo-router";
import { View } from "react-native";

import { SettingsCard, SettingsLayout } from "@/components/SettingsLayout";
import { Banner, Divider, ToggleRow } from "@/components/ui/Controls";
import { SelectField } from "@/components/ui/SelectField";
import type { NotificationPrefs } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_NOTIFICATION_PREFS } from "@/services/mockBackend";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

export default function NotificationSettingsScreen() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/settings/notifications" } }} />;

  const prefs = state.notificationPrefs[user.id] ?? DEFAULT_NOTIFICATION_PREFS;
  const set = (patch: Partial<NotificationPrefs>) => void backend.updateNotificationPrefs(patch);
  const hourLabel = (h: string) => {
    const [hh = 0] = h.split(":").map(Number);
    const date = new Date(2026, 0, 1, hh, 0);
    return date.toLocaleTimeString(locale === "es" ? "es-CO" : "en-US", { hour: "numeric", minute: "2-digit" });
  };
  const hourOptions = HOURS.map((h) => ({ value: h, label: hourLabel(h) }));

  return (
    <SettingsLayout section="notifications" title={t("settings.notifications")}>
      <SettingsCard title={t("notificationSettings.prefsTitle")} subtitle={t("notificationSettings.prefsSubtitle")}>
        <ToggleRow
          icon="paw"
          tone="lost"
          title={t("notificationSettings.lostNearby")}
          description={t("notificationSettings.lostNearbyDesc")}
          value={prefs.lostNearby}
          onChange={(v) => set({ lostNearby: v })}
          testID="pref-lost"
        />
        <Divider />
        <ToggleRow
          icon="paw-outline"
          tone="found"
          title={t("notificationSettings.foundNearby")}
          description={t("notificationSettings.foundNearbyDesc")}
          value={prefs.foundNearby}
          onChange={(v) => set({ foundNearby: v })}
        />
        <Divider />
        <ToggleRow
          icon="chatbox-ellipses-outline"
          tone="warning"
          title={t("notificationSettings.comments")}
          description={t("notificationSettings.commentsDesc")}
          value={prefs.comments}
          onChange={(v) => set({ comments: v })}
        />
        <Divider />
        <ToggleRow
          icon="chatbubble-ellipses-outline"
          tone="violet"
          title={t("notificationSettings.directMessages")}
          description={t("notificationSettings.directMessagesDesc")}
          value={prefs.directMessages}
          onChange={(v) => set({ directMessages: v })}
        />
        <Divider />
        <ToggleRow
          icon="people-outline"
          tone="blue"
          title={t("notificationSettings.groups")}
          description={t("notificationSettings.groupsDesc")}
          value={prefs.groups}
          onChange={(v) => set({ groups: v })}
        />
        <Divider />
        <ToggleRow
          icon="radio-button-on"
          tone="primary"
          title={t("notificationSettings.lifeCircle")}
          description={t("notificationSettings.lifeCircleDesc")}
          value={prefs.lifeCircle}
          onChange={(v) => set({ lifeCircle: v })}
        />
      </SettingsCard>

      <SettingsCard title={t("notificationSettings.quietTitle")} subtitle={t("notificationSettings.quietSubtitle")}>
        <ToggleRow
          icon="moon-outline"
          tone="violet"
          title={t("notificationSettings.quietMode")}
          description={t("notificationSettings.quietModeDesc")}
          value={prefs.quietHours}
          onChange={(v) => set({ quietHours: v })}
        />
        {prefs.quietHours ? (
          <View className="mt-2 flex-row gap-2">
            <SelectField
              compact
              label={t("notificationSettings.from")}
              icon="moon-outline"
              value={prefs.quietFrom}
              options={hourOptions}
              onChange={(v) => set({ quietFrom: v })}
            />
            <SelectField
              compact
              label={t("notificationSettings.to")}
              icon="sunny-outline"
              value={prefs.quietTo}
              options={hourOptions}
              onChange={(v) => set({ quietTo: v })}
            />
          </View>
        ) : null}
      </SettingsCard>

      <SettingsCard title={t("notificationSettings.channels")} subtitle={t("notificationSettings.channelsSubtitle")}>
        <ToggleRow
          icon="phone-portrait-outline"
          tone="primary"
          title={t("notificationSettings.push")}
          description={t("notificationSettings.pushDesc")}
          value={prefs.push}
          onChange={(v) => set({ push: v })}
        />
        <Divider />
        <ToggleRow
          icon="mail-outline"
          tone="primary"
          title={t("notificationSettings.email")}
          description={t("notificationSettings.emailDesc")}
          value={prefs.email}
          onChange={(v) => set({ email: v })}
        />
        <Divider />
        <ToggleRow
          icon="calendar-outline"
          tone="primary"
          title={t("notificationSettings.digest")}
          description={t("notificationSettings.digestDesc")}
          value={prefs.dailyDigest}
          onChange={(v) => set({ dailyDigest: v })}
        />
      </SettingsCard>

      <Banner
        icon="notifications-outline"
        title={t("notificationSettings.important")}
        body={`${t("notificationSettings.importantBody")} ${t("notificationSettings.consentNote")}`}
      />
    </SettingsLayout>
  );
}
