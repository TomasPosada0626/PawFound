import { useState } from "react";
import { Linking, TextInput, View } from "react-native";

import { formatDistance } from "@/domain/geo";
import type { Place } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useCurrentUser } from "@/store/backend";

import { DirectionsOptions } from "./DirectionsSheet";
import { Button } from "./ui/Button";
import { Banner, ToggleRow } from "./ui/Controls";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

/**
 * Ficha de una veterinaria: llamar, sitio web, "Vamos" (ruta en Waze, Google Maps o Mapas de
 * Apple) y reportar un error. Con `notifyThreadId` (al llevar una mascota encontrada) ofrece
 * avisar en el grupo del caso a qué veterinaria va, para que la familia sepa dónde buscarla.
 */
export function PlaceSheet({
  place,
  distance,
  onClose,
  notifyThreadId,
}: {
  place: Place | null;
  distance?: number;
  onClose: () => void;
  notifyThreadId?: string;
}) {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const user = useCurrentUser();
  const toast = useToast();
  const [step, setStep] = useState<"info" | "go" | "report">("info");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  // Un solo aviso por veterinaria aunque se toque "Vamos" varias veces.
  const [notifiedFor, setNotifiedFor] = useState<string | null>(null);

  const close = () => {
    setStep("info");
    setNote("");
    onClose();
  };
  if (!place) return null;

  const go = () => {
    setStep("go");
    if (!notifyThreadId || !notify || notifiedFor === place.id) return;
    setNotifiedFor(place.id);
    void backend
      .shareLocation(notifyThreadId, { kind: "place", placeId: place.id }, locale)
      .then(() => toast(t("places.notified")))
      .catch(() => {
        setNotifiedFor(null);
        toast(t("errors.unknown"), "error");
      });
  };

  const sendReport = async () => {
    await backend.reportPlace(place.id, note);
    toast(t("places.reported"));
    close();
  };

  return (
    <Sheet
      visible
      onClose={close}
      title={step === "go" ? t("directions.title") : place.name}
      subtitle={step === "go" ? place.name : undefined}
      testID="place-sheet"
    >
      {step === "go" ? (
        <View className="pb-2">
          <DirectionsOptions destination={place.location} label={place.name} />
          <Button label={t("common.back")} variant="ghost" className="mt-3" onPress={() => setStep("info")} />
        </View>
      ) : step === "report" ? (
        <View className="gap-3 pb-2">
          <TextInput
            accessibilityLabel={t("places.reportPlaceholder")}
            placeholder={t("places.reportPlaceholder")}
            value={note}
            onChangeText={setNote}
            maxLength={300}
            multiline
            className="min-h-[80px] rounded-2xl bg-surface-alt p-4 font-regular text-[15px] text-ink"
            testID="place-report-note"
          />
          <Button
            label={t("places.reportSend")}
            onPress={() => void sendReport()}
            disabled={!note.trim()}
            testID="place-report-send"
          />
          <Button label={t("common.cancel")} variant="ghost" onPress={() => setStep("info")} />
        </View>
      ) : (
        <>
          <Text variant="captionStrong" tone="primary">
            {`${t("places.vet")}${distance !== undefined ? ` · ${formatDistance(distance, locale)}` : ""}`}
          </Text>
          {place.address ? (
            <Text variant="body" className="mt-1">
              {place.address}
            </Text>
          ) : null}
          {place.openingHours ? (
            <Text variant="caption" className="mt-1">
              {t("places.hours", { hours: place.openingHours })}
            </Text>
          ) : null}
          {place.emergency ? (
            <View className="mt-2">
              <Banner tone="lost" icon="medkit-outline" body={t("places.emergency")} />
            </View>
          ) : null}
          {notifyThreadId ? (
            <ToggleRow
              icon="people-outline"
              title={t("places.notifyGroup")}
              description={t("places.notifyGroupHint")}
              value={notify}
              onChange={setNotify}
              testID="place-notify"
            />
          ) : null}
          <View className="mt-4 gap-3 pb-2">
            <Button label={t("places.go")} icon="navigate" onPress={go} testID="place-go" />
            {place.phone ? (
              <Button
                label={t("places.call", { phone: place.phone })}
                icon="call"
                variant="outline"
                onPress={() => void Linking.openURL(`tel:${place.phone?.replace(/[^\d+]/g, "")}`)}
                testID="place-call"
              />
            ) : null}
            {place.website ? (
              <Button
                label={t("places.website")}
                icon="globe-outline"
                variant="ghost"
                onPress={() => place.website && void Linking.openURL(place.website)}
                testID="place-website"
              />
            ) : null}
            {user ? (
              <Button
                label={t("places.report")}
                icon="flag-outline"
                variant="ghost"
                onPress={() => setStep("report")}
                testID="place-report"
              />
            ) : null}
          </View>
          <Text variant="caption" className="mt-1">
            {t("places.attribution")}
          </Text>
        </>
      )}
    </Sheet>
  );
}
