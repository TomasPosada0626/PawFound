import { Linking } from "react-native";

import type { LatLng } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { directionsUrl, navigationApps, type NavigationApp } from "@/services/directions";

import { ListRow } from "./ui/Controls";
import type { IconName } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

const APP_ICON: Record<NavigationApp, IconName> = { google: "logo-google", waze: "car-outline", apple: "logo-apple" };

/** Botones para abrir la ruta en Google Maps, Waze o Mapas de Apple. */
export function DirectionsOptions({ destination, label }: { destination: LatLng; label?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <>
      {navigationApps().map((app) => (
        <ListRow
          key={app}
          icon={APP_ICON[app]}
          tone="blue"
          title={t(`directions.${app}`)}
          onPress={() =>
            void Linking.openURL(directionsUrl(app, destination, label)).catch(() => toast(t("errors.unknown"), "error"))
          }
          testID={`directions-${app}`}
        />
      ))}
      <Text variant="caption" className="mt-2">
        {t("directions.privacy")}
      </Text>
    </>
  );
}

/** Hoja "¿Con qué app vamos?" para un punto (ubicación compartida en el chat). */
export function DirectionsSheet({
  target,
  onClose,
}: {
  target: { destination: LatLng; label?: string } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet visible={target !== null} onClose={onClose} title={t("directions.title")} testID="directions-sheet">
      {target ? <DirectionsOptions destination={target.destination} label={target.label} /> : null}
    </Sheet>
  );
}
