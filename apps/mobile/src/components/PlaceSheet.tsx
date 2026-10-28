import { useState } from "react";
import { Linking, Platform, TextInput, View } from "react-native";

import { formatDistance } from "@/domain/geo";
import type { Place } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useBackend, useCurrentUser } from "@/store/backend";

import { Button } from "./ui/Button";
import { Banner } from "./ui/Controls";
import { Sheet } from "./ui/Sheet";
import { Text } from "./ui/Text";
import { useToast } from "./ui/Toast";

/** Ficha de una veterinaria o refugio: llamar, sitio web, cómo llegar y reportar un error. */
export function PlaceSheet({ place, distance, onClose }: { place: Place | null; distance?: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const user = useCurrentUser();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");

  const close = () => {
    setReporting(false);
    setNote("");
    onClose();
  };
  if (!place) return null;

  const directions = () => {
    const { latitude, longitude } = place.location;
    const label = encodeURIComponent(place.name);
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${latitude},${longitude}&q=${label}`
        : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    void Linking.openURL(url);
  };

  const sendReport = async () => {
    await backend.reportPlace(place.id, note);
    toast(t("places.reported"));
    close();
  };

  return (
    <Sheet visible onClose={close} title={place.name} testID="place-sheet">
      <Text variant="captionStrong" tone={place.kind === "vet" ? "primary" : "found"}>
        {`${place.kind === "vet" ? t("places.vet") : t("places.shelter")}${distance !== undefined ? ` · ${formatDistance(distance, locale)}` : ""}`}
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

      {reporting ? (
        <View className="mt-4 gap-3 pb-2">
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
          <Button label={t("common.cancel")} variant="ghost" onPress={() => setReporting(false)} />
        </View>
      ) : (
        <View className="mt-4 gap-3 pb-2">
          <Button label={t("places.directions")} icon="navigate" onPress={directions} testID="place-directions" />
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
              onPress={() => setReporting(true)}
              testID="place-report"
            />
          ) : null}
        </View>
      )}
      <Text variant="caption" className="mt-1">
        {t("places.attribution")}
      </Text>
    </Sheet>
  );
}
