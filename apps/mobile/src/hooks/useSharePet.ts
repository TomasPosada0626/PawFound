import { useCallback } from "react";
import { Share } from "react-native";

import { petDisplayName } from "@/components/pets";
import { useToast } from "@/components/ui/Toast";
import { SHARE_BASE_URL } from "@/config";
import type { PetCase } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend } from "@/store/backend";

/** Compartir un caso por WhatsApp, redes, etc. Cuenta para "Difusor" y para el caso. */
export function useSharePet() {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  return useCallback(
    async (pet: PetCase) => {
      try {
        const result = await Share.share({
          message: t("pet.shareMessage", {
            status: (pet.kind === "lost" ? t("status.lost") : t("status.found")).toUpperCase(),
            name: petDisplayName(pet, t),
            species: t(`speciesLower.${pet.species}`),
            zone: pet.zone,
            url: `${SHARE_BASE_URL}${pet.id}`,
          }),
        });
        if (result.action !== Share.dismissedAction) {
          await backend.sharePet(pet.id);
          toast(t("pet.shared"));
        }
      } catch {
        toast(t("errors.unknown"), "error");
      }
    },
    [backend, t, toast],
  );
}
