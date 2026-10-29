import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";

import { SettingsCard, SettingsLayout } from "@/components/SettingsLayout";
import { Divider, IconBubble, ListRow, ToggleRow } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { ConfirmSheet, OptionList, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { maskEmail } from "@/domain/privacy";
import type { WhoCanMessage } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_PRIVACY_PREFS } from "@/services/mockBackend";
import { STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

export default function PrivacyScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const [whoOpen, setWhoOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/settings/privacy" } }} />;
  const prefs = state.privacyPrefs[user.id] ?? DEFAULT_PRIVACY_PREFS;
  const whoLabel = (w: WhoCanMessage) =>
    w === "everyone" ? t("privacy.everyone") : w === "verified" ? t("privacy.verified") : t("privacy.nobody");

  const exportData = async () => {
    try {
      const json = await backend.exportData();
      await Share.share({ message: json, title: "pawfound-datos.json" });
      toast(t("privacy.exportReady"), "info");
    } catch {
      toast(t("errors.unknown"), "error");
    }
  };

  const deleteAccount = async () => {
    setDeleteOpen(false);
    await backend.deleteAccount();
    await writeJSON(STORAGE_KEYS.session, null);
    toast(t("privacy.deleted"), "info");
    router.replace("/");
  };

  return (
    <SettingsLayout
      section="privacy"
      title={t("settings.privacy")}
      right={<Icon name="shield-checkmark-outline" size={26} color={colors.primaryStrong} />}
    >
      <SettingsCard title={t("privacy.accountSecurity")} icon="shield-checkmark-outline">
        <ListRow
          icon="call-outline"
          title={user.verified ? t("privacy.emailVerified") : t("privacy.phoneNotVerified")}
          description={maskEmail(user.email)}
          value={user.verified ? t("privacy.verifiedTag") : t("privacy.verifyNow")}
          onPress={() => router.push({ pathname: "/auth/verify", params: { next: "/settings/privacy" } })}
        />
        <Divider />
        <ListRow icon="mail-outline" title={t("privacy.email")} description={maskEmail(user.email)} />
        <Divider />
        <ListRow
          icon="lock-closed-outline"
          title={t("privacy.password")}
          description="••••••••••"
          onPress={() => toast(t("privacy.passwordChange"), "info")}
        />
        <Divider />
        <ListRow
          icon="phone-portrait-outline"
          title={t("privacy.devices")}
          description={t("privacy.devicesCount", { count: 1 })}
        />
      </SettingsCard>

      <SettingsCard title={t("privacy.privacy")} icon="lock-closed-outline">
        <ListRow
          title={t("privacy.whoCanMessage")}
          description={t("privacy.whoCanMessageDesc")}
          value={whoLabel(prefs.whoCanMessage)}
          onPress={() => setWhoOpen(true)}
          testID="who-can-message"
        />
      </SettingsCard>

      <SettingsCard title={t("privacy.visibility")} icon="eye-outline">
        <ListRow title={t("privacy.visibleInfo")} description={t("privacy.visibleInfoDesc")} />
        <Divider />
        {/* Siempre activo: es una garantía del producto, no una preferencia (issue #46). */}
        <ToggleRow title={t("privacy.hideExact")} description={t("privacy.hideExactDesc")} value onChange={() => {}} disabled />
      </SettingsCard>

      <SettingsCard title={t("privacy.safetyTitle")} icon="flag-outline">
        <ListRow title={t("privacy.safetyNoBlocks")} description={t("privacy.safetyBody")} />
      </SettingsCard>

      <SettingsCard title={t("privacy.yourData")} icon="download-outline">
        <ListRow
          title={t("privacy.exportData")}
          description={t("privacy.exportDataDesc")}
          onPress={() => void exportData()}
          testID="export-data"
        />
      </SettingsCard>

      <SettingsCard title={t("privacy.deleteAccount")} icon="trash-outline" tone="danger">
        <ListRow
          title={t("privacy.deleteMine")}
          description={t("privacy.deleteDesc")}
          danger
          onPress={() => setDeleteOpen(true)}
          testID="delete-account"
        />
      </SettingsCard>

      <View className="flex-row gap-3 rounded-3xl border border-border/60 bg-surface p-4">
        <IconBubble icon="shield-checkmark" />
        <View className="flex-1">
          <Text variant="bodyStrong">{t("privacy.protectedTitle")}</Text>
          <Text variant="caption">{t("privacy.protectedBody")}</Text>
        </View>
      </View>

      <Sheet
        visible={whoOpen}
        onClose={() => setWhoOpen(false)}
        title={t("privacy.whoCanMessage")}
        subtitle={t("privacy.whoCanMessageDesc")}
      >
        <OptionList
          options={(["everyone", "verified", "nobody"] as WhoCanMessage[]).map((w) => ({ value: w, label: whoLabel(w) }))}
          value={prefs.whoCanMessage}
          onSelect={(w) => {
            void backend.updatePrivacy({ whoCanMessage: w });
            setWhoOpen(false);
          }}
        />
      </Sheet>

      <ConfirmSheet
        visible={deleteOpen}
        title={t("privacy.deleteConfirmTitle")}
        body={t("privacy.deleteConfirmBody")}
        confirmLabel={t("privacy.deleteConfirm")}
        danger
        onConfirm={() => void deleteAccount()}
        onCancel={() => setDeleteOpen(false)}
      />
    </SettingsLayout>
  );
}
