import { useState } from "react";

import { petSentence } from "@/features/petNames";
import type { PetCase } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

import { IconButton } from "./ui/IconButton";
import { ConfirmSheet } from "./ui/Sheet";
import { useToast } from "./ui/Toast";

/** Papelera para que la familia elimine su publicación, perdida o encontrada, tras confirmar. */
export function DeletePetButton({ pet }: { pet: PetCase }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const remove = async () => {
    setLoading(true);
    try {
      await backend.withdrawPet(pet.id);
      toast(t("list.deleted"));
    } catch {
      toast(t("errors.unknown"), "error");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <>
      <IconButton
        icon="trash-outline"
        label={petSentence(t, "list.deleteLabel", pet)}
        color={colors.danger}
        onPress={() => setOpen(true)}
        testID={`delete-pet-${pet.id}`}
      />
      <ConfirmSheet
        visible={open}
        title={petSentence(t, "list.deleteTitle", pet)}
        body={t("list.deleteBody")}
        confirmLabel={t("list.deleteConfirm")}
        danger
        loading={loading}
        onConfirm={() => void remove()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
