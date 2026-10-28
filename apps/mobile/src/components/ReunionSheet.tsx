import { useMemo, useState } from "react";
import { View } from "react-native";

import { shortName } from "@/domain/privacy";
import type { PetCase } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_HELPERS } from "@/services/mockBackend";
import { reunionHelperCandidates } from "@/services/selectors";
import { useBackendState } from "@/store/backend";

import { BadgeHex } from "./badges";
import { UserAvatar } from "./pets";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Controls";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";

/**
 * Cierre del caso con agradecimiento ("Ángel de patas"): la familia elige, entre quienes
 * participaron de verdad, a quienes fueron clave. Elegir a nadie también es válido.
 */
export function ReunionSheet({
  pet,
  name,
  visible,
  loading,
  onConfirm,
  onCancel,
}: {
  pet: PetCase;
  name: string;
  visible: boolean;
  loading?: boolean;
  onConfirm: (helperIds: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const state = useBackendState();
  const candidates = useMemo(() => reunionHelperCandidates(state, pet.id), [state, pet.id]);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (userId: string, next: boolean) =>
    setSelected((prev) => (next ? [...prev, userId].slice(0, MAX_HELPERS) : prev.filter((id) => id !== userId)));

  return (
    <Sheet visible={visible} onClose={onCancel} title={t("pet.reuniteConfirmTitle", { name })} testID="reunion-sheet">
      <Text variant="body" className="mb-4">
        {t("pet.reuniteConfirmBody")}
      </Text>
      {candidates.length ? (
        <View className="mb-4 rounded-3xl bg-surface-alt p-4">
          <View className="flex-row items-center gap-3">
            <BadgeHex id="paw_angel" tier={1} size={48} />
            <View className="flex-1">
              <Text variant="bodyStrong">{t("pet.thankTitle", { name })}</Text>
              <Text variant="caption">{t("pet.thankBody")}</Text>
            </View>
          </View>
          <View className="mt-3">
            {candidates.map((c) => (
              <Checkbox
                key={c.userId}
                checked={selected.includes(c.userId)}
                onChange={(next) => toggle(c.userId, next)}
                label={`${shortName(c.user.name)}. ${c.reasons.map((r) => t(`pet.thankReason_${r}`)).join(", ")}`}
                testID={`thank-${c.userId}`}
              >
                <View className="flex-row items-center gap-3">
                  <UserAvatar user={c.user} size={40} />
                  <View className="flex-1">
                    <Text variant="bodyStrong">{shortName(c.user.name)}</Text>
                    <Text variant="caption">{c.reasons.map((r) => t(`pet.thankReason_${r}`)).join(" · ")}</Text>
                  </View>
                </View>
              </Checkbox>
            ))}
          </View>
          {selected.length >= MAX_HELPERS ? (
            <Text variant="caption" accessibilityLiveRegion="polite">
              {t("pet.thankMax", { count: MAX_HELPERS })}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="caption" className="mb-4">
          {t("pet.thankNone")}
        </Text>
      )}
      <View className="gap-3 pb-2">
        <Button
          label={selected.length ? t("pet.thankConfirm") : t("pet.reuniteConfirm")}
          icon="home"
          onPress={() => onConfirm(selected)}
          loading={loading}
          testID="reunite-confirm"
        />
        <Button label={t("common.cancel")} variant="ghost" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
