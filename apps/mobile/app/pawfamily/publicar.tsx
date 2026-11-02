import * as ImagePicker from "expo-image-picker";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { Screen } from "@/components/layout";
import { PawFamilyHeader } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner, Checkbox, Chip } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import type { AdoptionInput } from "@/domain/adoption";
import type { AgeRange, LatLng, PetSize, Sex, Species } from "@/domain/types";
import { errorMessage } from "@/features/errorMessages";
import { usePlacePicker } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { useBackend, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const MAX_PHOTOS = 5;

type Form = Omit<AdoptionInput, "location"> & { location: LatLng | null };

/** Dar una mascota en adopción. La dirección es opcional y solo la ve la persona aceptada. */
export default function PublishAdoptionScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const user = useCurrentUser();
  const toast = useToast();
  const pickPlace = usePlacePicker();
  const [form, setForm] = useState<Form>({
    name: "",
    species: "dog",
    sex: "female",
    age: "young",
    size: "medium",
    description: "",
    vaccinated: false,
    sterilized: false,
    photos: [],
    location: null,
    zone: "",
  });
  const [missing, setMissing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/pawfamily/publicar" } }} />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const addPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast(t("report.photoPermission"), "error");
      return;
    }
    // exif: false — no se leen metadatos (GPS) de las fotos.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      exif: false,
      allowsMultipleSelection: true,
    });
    if (result.canceled) return;
    setForm((f) => ({ ...f, photos: [...f.photos, ...result.assets.map((a) => a.uri)].slice(0, MAX_PHOTOS) }));
  };

  const fillLocation = async () => {
    const place = await pickPlace();
    if (!place) {
      toast(t("pawfamily.locationNeeded"), "error");
      return;
    }
    setForm((f) => ({ ...f, location: place.point, zone: f.zone || place.zone || "" }));
  };

  const publish = async () => {
    const problem = !form.photos.length
      ? "photos"
      : !form.name.trim()
        ? "name"
        : !form.description.trim()
          ? "description"
          : !form.location || !form.zone.trim()
            ? "location"
            : null;
    setMissing(problem);
    if (problem || !form.location) return;
    setSaving(true);
    try {
      await backend.acceptAdoptionTerms();
      const id = await backend.createAdoption({ ...form, location: form.location });
      toast(t("pawfamily.published", { name: form.name.trim() }));
      router.replace(`/pawfamily/${id}`);
    } catch (err) {
      toast(errorMessage(err instanceof BackendError ? err.code : "unknown", t), "error");
    } finally {
      setSaving(false);
    }
  };

  const choose = <V extends string>(key: keyof Form, options: readonly V[], label: (v: V) => string) => (
    <View className="flex-row flex-wrap gap-2">
      {options.map((v) => (
        <Chip
          key={v}
          label={label(v)}
          selected={form[key] === v}
          onPress={() => set(key, v as never)}
          testID={`publish-${String(key)}-${v}`}
        />
      ))}
    </View>
  );

  return (
    <Screen header={<PawFamilyHeader back title={t("pawfamily.publishTitle")} />} testID="adoption-publish">
      <View className="gap-3">
        <Banner icon="heart-outline" body={t("pawfamily.freeBanner")} />
        <Text variant="captionStrong">{t("pawfamily.photos")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {form.photos.map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width: 88, height: 88, borderRadius: 16 }} />
          ))}
          {form.photos.length < MAX_PHOTOS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("pawfamily.addPhoto")}
              onPress={() => void addPhoto()}
              className="h-[88px] w-[88px] items-center justify-center rounded-2xl border-2 border-dashed border-border active:opacity-70"
              testID="publish-add-photo"
            >
              <Icon name="camera-outline" size={26} color={colors.muted} />
            </Pressable>
          ) : null}
        </ScrollView>
        {missing === "photos" ? (
          <Text variant="caption" tone="lost">
            {t("pawfamily.missing_photos")}
          </Text>
        ) : null}

        <TextField
          label={t("pawfamily.petName")}
          value={form.name}
          onChangeText={(v) => set("name", v)}
          maxLength={40}
          error={missing === "name" ? t("errors.required") : undefined}
          testID="publish-name"
        />
        <Text variant="captionStrong">{t("pawfamily.species")}</Text>
        {choose<Species>("species", ["dog", "cat", "other"], (v) => t(`species.${v}`))}
        <TextField
          label={t("pawfamily.breedOptional")}
          value={form.breed ?? ""}
          onChangeText={(v) => set("breed", v)}
          maxLength={60}
        />
        <Text variant="captionStrong">{t("pet.sex")}</Text>
        {choose<Sex>("sex", ["female", "male", "unknown"], (v) => t(`sex.${v}`))}
        <Text variant="captionStrong">{t("pet.age")}</Text>
        {choose<AgeRange>("age", ["puppy", "young", "adult", "senior", "unknown"], (v) => t(`age.${v}`))}
        <Text variant="captionStrong">{t("pet.size")}</Text>
        {choose<PetSize>("size", ["small", "medium", "large"], (v) => t(`size.${v}`))}
        <TextField
          label={t("pawfamily.colorOptional")}
          value={form.color ?? ""}
          onChangeText={(v) => set("color", v)}
          maxLength={60}
        />
        <Checkbox checked={form.vaccinated} onChange={(v) => set("vaccinated", v)} label={t("pawfamily.vaccinated")} />
        <Checkbox checked={form.sterilized} onChange={(v) => set("sterilized", v)} label={t("pawfamily.sterilized")} />
        <TextField
          label={t("pawfamily.description")}
          value={form.description}
          onChangeText={(v) => set("description", v)}
          multiline
          maxLength={500}
          showCounter
          error={missing === "description" ? t("errors.required") : undefined}
          testID="publish-description"
        />

        <Text variant="captionStrong">{t("pawfamily.where")}</Text>
        <Button
          variant={form.location ? "soft" : "outline"}
          icon="locate"
          label={form.location ? t("pawfamily.locationSet") : t("pawfamily.useLocation")}
          onPress={() => void fillLocation()}
          testID="publish-location"
        />
        <TextField
          label={t("pawfamily.zone")}
          value={form.zone}
          onChangeText={(v) => set("zone", v)}
          maxLength={80}
          hint={t("pawfamily.zoneHint")}
          testID="publish-zone"
        />
        {missing === "location" ? (
          <Text variant="caption" tone="lost">
            {t("pawfamily.missing_location")}
          </Text>
        ) : null}
        <TextField
          label={t("pawfamily.addressOptional")}
          value={form.address ?? ""}
          onChangeText={(v) => set("address", v)}
          maxLength={120}
          hint={t("pawfamily.addressHint")}
          testID="publish-address"
        />
        <Button
          label={t("pawfamily.publishSend")}
          icon="heart"
          loading={saving}
          onPress={() => void publish()}
          testID="publish-send"
        />
      </View>
    </Screen>
  );
}
