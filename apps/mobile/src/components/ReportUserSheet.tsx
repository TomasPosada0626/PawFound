import { useState } from "react";
import { View } from "react-native";

import { shortName } from "@/domain/privacy";
import type { User, UserReportReason } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend } from "@/store/backend";

import { Button } from "./ui/Button";
import { OptionList, Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

const REASONS: UserReportReason[] = ["spam", "rude", "scam", "inappropriate", "other"];

/** Reportar a una persona (no hay bloqueos). Si viene de un mensaje, se adjunta como contexto. */
export function ReportUserSheet({
  target,
  threadId,
  messageId,
  onClose,
}: {
  target: User | null;
  threadId?: string;
  messageId?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const [reason, setReason] = useState<UserReportReason | null>(null);
  const [sending, setSending] = useState(false);

  const close = () => {
    setReason(null);
    onClose();
  };

  const send = async () => {
    if (!target || !reason) return;
    setSending(true);
    try {
      await backend.reportUser({ userId: target.id, reason, threadId, messageId });
      toast(t("chat.reportSent"), "info");
      close();
    } catch {
      toast(t("errors.unknown"), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(target)}
      onClose={close}
      title={target ? t("chat.reportTitle", { name: shortName(target.name) }) : undefined}
      subtitle={t("chat.reportBody")}
      testID="report-user-sheet"
    >
      <OptionList
        options={REASONS.map((r) => ({ value: r, label: t(`chat.reason_${r}`) }))}
        value={reason}
        onSelect={setReason}
      />
      <View className="gap-3 pb-2">
        <Button
          label={t("chat.reportSend")}
          variant="danger"
          icon="flag"
          disabled={!reason}
          loading={sending}
          onPress={() => void send()}
          testID="report-user-send"
        />
        <Text variant="caption" className="text-center">
          {t("chat.reportPrivacy")}
        </Text>
      </View>
    </Sheet>
  );
}
