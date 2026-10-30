import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { Button } from "@/components/ui/Button";
import { Chip, ToggleRow } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { SelectField } from "@/components/ui/SelectField";
import { ConfirmSheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import type { AgeRange, PetSize, Sex, Species } from "@/domain/types";
import { DESCRIPTION_MAX } from "@/domain/validation";
import { useI18n } from "@/i18n/I18nProvider";
import type { OwnedPetInput } from "@/services/backendTypes";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const MAX_PROFILE_PHOTOS = 3;

const EMPTY: OwnedPetInput = {
  name: "",
  species: "dog",
  sex: "unknown",
  age: "adult",
  size: "medium",
  description: "",
  photos: [],
  shyOrIndoor: false,
};

/** Crear o editar el perfil preventivo de una mascota propia. */
export default function EditOwnedPetScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const existing = id ? state.ownedPets.find((p) => p.id === id && p.ownerId === user?.id) : undefined;
  const [form, setForm] = useState<OwnedPetInput>(() => {
    if (!existing) return EMPTY;
    const { id: _id, ownerId: _owner, createdAt: _created, lastCaseId: _case, ...rest } = existing;
    return rest;
  });
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/my-pets" } }} />;

  const set = <K extends keyof OwnedPetInput>(key: K, value: OwnedPetInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const addPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast(t("report.photoPermission"), "error");
      return;
    }
    // exif: false — no se leen metadatos (GPS) en la app.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
    if (result.canceled) return;
    setForm((f) => ({ ...f, photos: [...f.photos, ...result.assets.map((a) => a.uri)].slice(0, MAX_PROFILE_PHOTOS) }));
  };

  const save = async () => {
    if (!form.name.trim()) {
      setNameError(t("errors.required"));
      return;
    }
    setSaving(true);
    try {
      const saved = await backend.saveOwnedPet(form, existing?.id);
      toast(t("myPets.saved", { name: saved.name }));
      router.replace("/my-pets");
    } catch {
      toast(t("errors.unknown"), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setConfirmDelete(false);
    await backend.deleteOwnedPet(existing.id);
    toast(t("myPets.deleted"));
    router.replace("/my-pets");
  };

  const ageOptions = (["puppy", "young", "adult", "senior", "unknown"] as AgeRange[]).map((a) => ({
    value: a,
    label: t(`age.${a}`),
  }));

  return (
    <Screen
      header={
        <AppHeader
          left={<BackButton fallback="/my-pets" />}
          title={existing ? t("myPets.editTitle", { name: existing.name }) : t("myPets.newTitle")}
        />
      }
      testID="owned-pet-form"
    >
      <View className="mb-4 flex-row flex-wrap gap-3">
        {form.photos.map((uri, i) => (
          <Pressable
            key={uri}
            accessibilityRole="button"
            accessibilityLabel={t("report.removePhoto", { index: i + 1 })}
            onPress={() =>
              set(
                "photos",
                form.photos.filter((p) => p !== uri),
              )
            }
            className="h-24 w-24 overflow-hidden rounded-2xl"
          >
            <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" accessible={false} />
            <View className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/50">
              <Icon name="close" size={16} color="#FFFFFF" />
            </View>
          </Pressable>
        ))}
        {form.photos.length === 0 ? (
          // Sin fotos, el botón ocupa todo el ancho: un cuadro pequeño dejaba un hueco vacío al lado.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("report.addPhoto")}
            onPress={() => void addPhoto()}
            className="min-h-[88px] flex-1 flex-row items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-surface px-4 active:opacity-80"
          >
            <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
              <Icon name="camera-outline" size={26} color={colors.primaryStrong} />
            </View>
            <View className="flex-1">
              <Text variant="bodyStrong" tone="primary">
                {t("report.addPhoto")}
              </Text>
              <Text variant="caption">{t("myPets.photosHint", { count: MAX_PROFILE_PHOTOS })}</Text>
            </View>
          </Pressable>
        ) : form.photos.length < MAX_PROFILE_PHOTOS ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("report.addPhoto")}
            onPress={() => void addPhoto()}
            className="h-24 w-24 items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border bg-surface"
          >
            <Icon name="camera-outline" size={26} color={colors.primaryStrong} />
            <Text variant="label" tone="primary">
              {t("report.addPhoto")}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="gap-3">
        <TextField
          label={t("report.name")}
          value={form.name}
          onChangeText={(v) => {
            set("name", v);
            setNameError(undefined);
          }}
          placeholderText={t("myPets.namePlaceholder")}
          error={nameError}
          maxLength={40}
          testID="owned-name"
        />
        <Text variant="label">{t("report.species")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(["dog", "cat", "other"] as Species[]).map((s) => (
            <Chip key={s} label={t(`species.${s}`)} selected={form.species === s} onPress={() => set("species", s)} icon="paw" />
          ))}
        </View>
        <TextField label={t("report.breed")} value={form.breed ?? ""} onChangeText={(v) => set("breed", v)} maxLength={60} />
        <Text variant="label">{t("report.sex")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(["male", "female", "unknown"] as Sex[]).map((s) => (
            <Chip key={s} label={t(`sex.${s}`)} selected={form.sex === s} onPress={() => set("sex", s)} />
          ))}
        </View>
        <SelectField
          label={t("report.age")}
          value={form.age}
          options={ageOptions}
          onChange={(v) => set("age", v)}
          icon="calendar-outline"
        />
        <Text variant="label">{t("report.size")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(["small", "medium", "large"] as PetSize[]).map((s) => (
            <Chip key={s} label={t(`size.${s}`)} selected={form.size === s} onPress={() => set("size", s)} />
          ))}
        </View>
        <TextField label={t("report.color")} value={form.color ?? ""} onChangeText={(v) => set("color", v)} maxLength={60} />
        <TextField label={t("report.collar")} value={form.collar ?? ""} onChangeText={(v) => set("collar", v)} maxLength={60} />
        <TextField label={t("report.marks")} value={form.marks ?? ""} onChangeText={(v) => set("marks", v)} maxLength={120} />
        <TextField
          label={t("report.description")}
          hint={t("report.descriptionHintLost")}
          value={form.description}
          onChangeText={(v) => set("description", v)}
          multiline
          maxLength={DESCRIPTION_MAX}
          showCounter
        />
        <ToggleRow
          icon="home-outline"
          tone="violet"
          title={t("report.shy")}
          description={t("report.shyHint")}
          value={form.shyOrIndoor}
          onChange={(v) => set("shyOrIndoor", v)}
        />
      </View>

      <View className="mt-6 gap-3">
        <Button label={t("common.save")} icon="checkmark" onPress={() => void save()} loading={saving} testID="owned-save" />
        {existing ? (
          <Button label={t("myPets.delete")} variant="ghost" icon="trash-outline" onPress={() => setConfirmDelete(true)} />
        ) : null}
      </View>

      <ConfirmSheet
        visible={confirmDelete}
        danger
        title={t("myPets.deleteTitle", { name: existing?.name ?? "" })}
        body={t("myPets.deleteBody")}
        confirmLabel={t("myPets.delete")}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}
