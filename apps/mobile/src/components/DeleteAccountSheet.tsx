import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";
import { TextField } from "./ui/TextField";
import { useToast } from "./ui/Toast";

/** Lo que se borra, en el orden en que la persona lo reconoce. */
const ERASED = ["profile", "reports", "pawfamily", "chats", "network", "pets"] as const;

/** Lo que este celular guardó de la cuenta. El tema, el idioma y los permisos son del celular. */
async function forgetOnDevice(userId: string) {
  const keys = [
    STORAGE_KEYS.session,
    STORAGE_KEYS.reportDraft,
    STORAGE_KEYS.favorites,
    STORAGE_KEYS.storiesSeen,
    STORAGE_KEYS.pawfamilyTerms,
    STORAGE_KEYS.pawfamilyRole,
    `${STORAGE_KEYS.badgesSeen}.${userId}`,
  ];
  await Promise.all(keys.map((key) => writeJSON(key, null)));
}

/**
 * Eliminar la cuenta: dice todo lo que se borra y pide escribir una palabra, para que no pase por
 * un toque sin querer. Está en Perfil y en Ajustes › Privacidad.
 */
export function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const user = useCurrentUser();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const word = t("deleteAccount.word");
  const ready = typed.trim().toLocaleUpperCase() === word;

  const close = () => {
    if (deleting) return;
    setTyped("");
    onClose();
  };

  const confirm = async () => {
    if (!ready || deleting || !user) return;
    setDeleting(true);
    try {
      await backend.deleteAccount();
    } catch {
      setDeleting(false);
      toast(t("deleteAccount.failed"), "error");
      return;
    }
    await forgetOnDevice(user.id);
    setDeleting(false);
    setTyped("");
    onClose();
    toast(t("privacy.deleted"), "info");
    router.replace("/");
  };

  return (
    <Sheet visible={visible} onClose={close} title={t("privacy.deleteConfirmTitle")} testID="delete-account-sheet">
      <Text variant="body" className="mb-3">
        {t("deleteAccount.intro")}
      </Text>
      <View className="mb-3 gap-2.5 rounded-2xl bg-lost-soft p-4">
        {ERASED.map((key) => (
          <View key={key} className="flex-row items-start gap-2">
            <Icon name="close-circle" size={18} color={colors.danger} />
            <Text variant="caption" tone="body" className="flex-1">
              {t(`deleteAccount.${key}`)}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="captionStrong" tone="danger" className="mb-1">
        {t("deleteAccount.permanent")}
      </Text>
      <Text variant="caption" className="mb-4">
        {t("deleteAccount.email")}
      </Text>
      <TextField
        label={t("deleteAccount.typeLabel", { word })}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        editable={!deleting}
        testID="delete-account-word"
      />
      <View className="mt-4 gap-3 pb-2">
        <Button
          label={t("privacy.deleteConfirm")}
          variant="danger"
          disabled={!ready}
          loading={deleting}
          onPress={() => void confirm()}
          testID="delete-account-confirm"
        />
        <Button label={t("common.cancel")} variant="ghost" onPress={close} />
      </View>
    </Sheet>
  );
}
