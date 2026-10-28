import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppHeader, BackButton, Screen, ThemeButton } from "@/components/layout";
import { LifeCircleDiagram, LifeCircleLegend } from "@/components/lifeCircle";
import { PetMap } from "@/components/map/PetMap";
import { Button } from "@/components/ui/Button";
import { Banner, ListRow, ToggleRow } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { SelectField } from "@/components/ui/SelectField";
import { OptionList, Sheet } from "@/components/ui/Sheet";
import { SegmentedControl } from "@/components/ui/Tabs";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import { formatDistance, regionForRadius } from "@/domain/geo";
import { FOUND_RADIUS_OPTIONS, hoursToCap, LIFE_CIRCLE_PROFILES, profileFor, radiusMeters } from "@/domain/lifeCircle";
import { DAILY_REPORT_LIMIT } from "@/domain/rules";
import type { AgeRange, FoundCondition, FoundCustody, PetSize, Sex, Species } from "@/domain/types";
import { DESCRIPTION_MAX, hasErrors, MAX_PHOTOS } from "@/domain/validation";
import {
  draftFromOwnedPet,
  emptyDraft,
  isDraftMeaningful,
  toReportInput,
  validateDraft,
  WHEN_KEYS,
  type DraftErrors,
  type ReportDraft,
} from "@/features/reportDraft";
import { usePlacePicker, zoneFromPoint } from "@/hooks/usePlacePicker";
import { clockTime } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useCurrentUser } from "@/store/backend";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";

export default function ReportScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const user = useCurrentUser();
  const toast = useToast();
  const { location } = useUserLocation();
  const pickPlace = usePlacePicker();
  const { fromPet } = useLocalSearchParams<{ fromPet?: string }>();
  // Perfil de "Mis mascotas" desde el que se abrió (solo si es de la cuenta actual).
  const [ownedPet] = useState(() =>
    backend.getSnapshot().ownedPets.find((p) => p.id === fromPet && p.ownerId === backend.getSnapshot().sessionUserId),
  );

  const [draft, setDraft] = useState<ReportDraft>(() => (ownedPet ? draftFromOwnedPet(ownedPet) : emptyDraft("lost")));
  const [restored, setRestored] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [radiusSheet, setRadiusSheet] = useState(false);
  const [locating, setLocating] = useState(false);
  const loaded = useRef(false);

  const allowance = user ? backend.publishAllowanceFor(user.id) : { allowed: true as const };

  // Borrador: se recupera al abrir y se guarda mientras se escribe.
  useEffect(() => {
    if (ownedPet) {
      loaded.current = true;
      return;
    }
    void readJSON<ReportDraft>(STORAGE_KEYS.reportDraft).then((saved) => {
      if (saved && isDraftMeaningful(saved)) {
        setDraft({ ...emptyDraft(saved.kind), ...saved });
        setRestored(true);
      }
      loaded.current = true;
    });
  }, [ownedPet]);
  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => void writeJSON(STORAGE_KEYS.reportDraft, isDraftMeaningful(draft) ? draft : null), 400);
    return () => clearTimeout(timer);
  }, [draft]);

  const update = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const profile = profileFor({
    species: draft.species ?? "other",
    traumaticEvent: draft.traumaticEvent,
    shyOrIndoor: draft.shyOrIndoor,
  });
  const previewRadius = draft.kind === "lost" ? radiusMeters(profile, 0) : draft.foundRadius;
  const center = draft.point ?? location;
  const region = useMemo(() => regionForRadius(center, Math.max(previewRadius, 400)), [center, previewRadius]);

  if (!user || !user.phoneVerified) return <Redirect href={{ pathname: "/auth/login", params: { next: "/report" } }} />;

  const err = (key: keyof DraftErrors) => {
    const code = errors[key];
    if (!code) return undefined;
    return code === "too_long" ? t("errors.too_long", { max: DESCRIPTION_MAX }) : t(`errors.${code}` as "errors.required");
  };

  const addPhotos = async (source: "camera" | "library") => {
    setPhotoSheet(false);
    const remaining = MAX_PHOTOS - draft.photos.length;
    if (remaining <= 0) return;
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast(t("report.photoPermission"), "error");
      return;
    }
    // exif: false — no se leen metadatos (GPS) en la app; el servidor los elimina del archivo.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: remaining });
    if (result.canceled) return;
    setDraft((d) => ({ ...d, photos: [...d.photos, ...result.assets.map((a) => a.uri)].slice(0, MAX_PHOTOS) }));
    setErrors((e) => ({ ...e, photos: undefined }));
  };

  const setPoint = async (point: { latitude: number; longitude: number }, zone?: string | null) => {
    setDraft((d) => ({ ...d, point }));
    setErrors((e) => ({ ...e, hasLocation: undefined }));
    const resolved = zone ?? (await zoneFromPoint(point));
    if (resolved) setDraft((d) => (d.zone.trim() ? d : { ...d, zone: resolved }));
  };

  const locateMe = async () => {
    setLocating(true);
    const place = await pickPlace();
    setLocating(false);
    if (place) await setPoint(place.point, place.zone);
  };

  const publish = async () => {
    const found = validateDraft(draft);
    setErrors(found);
    if (hasErrors(found)) {
      toast(t("report.fixErrors"), "error");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    setSubmitting(true);
    try {
      const pet = await backend.createReport({
        ...toReportInput(draft, new Date(), t("report.zoneUnknown")),
        ownedPetId: ownedPet?.id,
      });
      await writeJSON(STORAGE_KEYS.reportDraft, null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace({ pathname: "/report/success", params: { id: pet.id } });
    } catch (error) {
      if (error instanceof BackendError && error.code === "rate_limited") {
        toast(
          t("report.limitReached", {
            limit: DAILY_REPORT_LIMIT,
            time: clockTime(new Date(String(error.params.retryAt)), locale),
          }),
          "error",
        );
      } else {
        toast(t("errors.unknown"), "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const speciesOptions = (["dog", "cat", "other"] as Species[]).map((s) => ({
    value: s,
    label: t(`species.${s}`),
    icon: "paw" as const,
  }));
  const sexOptions = (["male", "female", "unknown"] as Sex[]).map((s) => ({ value: s, label: t(`sex.${s}`) }));
  const ageOptions = (["puppy", "young", "adult", "senior", "unknown"] as AgeRange[]).map((a) => ({
    value: a,
    label: t(`age.${a}`),
  }));
  const sizeOptions = (["small", "medium", "large"] as PetSize[]).map((s) => ({ value: s, label: t(`size.${s}`) }));
  const whenOptions = WHEN_KEYS.map((w) => ({ value: w, label: t(`whenOptions.${w}`) }));
  const conditionOptions = (["good", "scared", "injured", "needs_vet"] as FoundCondition[]).map((c) => ({
    value: c,
    label: t(`conditions.${c}`),
  }));
  const custodyOptions = (["with_me", "vet", "shelter", "left_there"] as FoundCustody[]).map((c) => ({
    value: c,
    label: t(`custodies.${c}`),
  }));
  const isLost = draft.kind === "lost";

  return (
    <Screen testID="report-screen" header={<AppHeader left={<BackButton />} right={<ThemeButton mode="dark" />} />}>
      <Text variant="title" className="mt-1 text-center" accessibilityRole="header">
        {t("report.title")}
      </Text>
      <Text variant="body" tone="muted" className="mb-4 text-center">
        {isLost ? t("report.subtitleLost") : t("report.subtitleFound")}
      </Text>

      {!allowance.allowed ? (
        <View className="mb-4">
          <Banner
            tone="warning"
            icon="time-outline"
            body={t("report.limitReached", { limit: DAILY_REPORT_LIMIT, time: clockTime(allowance.retryAt, locale) })}
          />
        </View>
      ) : null}
      {ownedPet ? (
        <View className="mb-4">
          <Banner icon="paw" body={t("myPets.prefilled", { name: ownedPet.name })} />
        </View>
      ) : null}
      {restored ? (
        <View className="mb-4">
          <Banner
            icon="document-text-outline"
            body={t("report.draftRestored")}
            action={
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDraft(emptyDraft(draft.kind));
                  setRestored(false);
                  void writeJSON(STORAGE_KEYS.reportDraft, null);
                }}
                className="min-h-[40px] justify-center"
              >
                <Text variant="captionStrong" tone="primary">
                  {t("report.discardDraft")}
                </Text>
              </Pressable>
            }
          />
        </View>
      ) : null}

      <SegmentedControl
        items={[
          { key: "lost", label: t("report.tabLost"), icon: "paw", iconColor: colors.lost },
          { key: "found", label: t("report.tabFound"), icon: "paw", iconColor: colors.primary },
        ]}
        value={draft.kind}
        onChange={(kind) => update("kind", kind)}
      />

      <Text variant="subheading" className="mb-3 mt-6" accessibilityRole="header">
        {t("report.petInfo")}
      </Text>

      {/* Fotos + nombre + tipo */}
      <View className="flex-row gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isLost ? t("report.addPhoto") : t("report.addPhotos")}. ${t("report.maxPhotos", { max: MAX_PHOTOS })}`}
          onPress={() => setPhotoSheet(true)}
          disabled={draft.photos.length >= MAX_PHOTOS}
          className={`w-[120px] items-center justify-center rounded-2xl border-[1.5px] border-dashed p-2 active:opacity-80 ${errors.photos ? "border-danger" : "border-primary"} bg-surface`}
          testID="add-photo"
        >
          <Icon name="camera-outline" size={30} color={colors.primaryStrong} />
          <Text variant="captionStrong" tone="primary" className="mt-1 text-center">
            {isLost ? t("report.addPhoto") : t("report.addPhotos")}
          </Text>
          <Text variant="label" tone="muted">
            {`${draft.photos.length}/${MAX_PHOTOS}`}
          </Text>
        </Pressable>
        <View className="flex-1 gap-3">
          <TextField
            label={isLost ? t("report.name") : t("report.nameFound")}
            icon="paw"
            value={draft.name}
            onChangeText={(v) => update("name", v)}
            error={err("name")}
            maxLength={40}
            testID="report-name"
          />
          <SelectField
            label={t("report.species")}
            icon="paw-outline"
            value={draft.species}
            options={speciesOptions}
            onChange={(v) => {
              update("species", v);
              setErrors((e) => ({ ...e, species: undefined }));
            }}
            error={err("species")}
            testID="report-species"
          />
        </View>
      </View>
      {errors.photos ? (
        <Text variant="caption" tone="danger" className="ml-1 mt-1" accessibilityLiveRegion="polite">
          {err("photos")}
        </Text>
      ) : null}
      {draft.photos.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {draft.photos.map((uri, index) => (
            <View key={uri} className="h-20 w-20 overflow-hidden rounded-xl bg-surface-alt">
              <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" accessible={false} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("report.removePhoto", { index: index + 1 })}
                onPress={() =>
                  update(
                    "photos",
                    draft.photos.filter((p) => p !== uri),
                  )
                }
                className="absolute right-0 top-0 h-9 w-9 items-center justify-center"
              >
                <View className="h-6 w-6 items-center justify-center rounded-full bg-black/60">
                  <Icon name="close" size={14} color="#FFFFFF" />
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <SelectField
          compact
          label={t("report.sex")}
          icon="male-female"
          value={draft.sex}
          options={sexOptions}
          onChange={(v) => update("sex", v)}
        />
        <SelectField
          compact
          label={isLost ? t("report.age") : t("report.ageFound")}
          icon="calendar-outline"
          value={draft.age}
          options={ageOptions}
          onChange={(v) => update("age", v)}
        />
        <SelectField
          compact
          label={t("report.size")}
          icon="resize"
          value={draft.size}
          options={sizeOptions}
          onChange={(v) => update("size", v)}
        />
      </View>

      <TextField
        className="mt-3"
        label={t("report.breed")}
        icon="pricetag-outline"
        value={draft.breed}
        onChangeText={(v) => update("breed", v)}
        maxLength={40}
      />
      <TextField
        className="mt-3"
        label={t("report.description")}
        icon="document-text-outline"
        placeholderText={isLost ? t("report.descriptionHintLost") : t("report.descriptionHintFound")}
        value={draft.description}
        onChangeText={(v) => update("description", v)}
        multiline
        maxLength={DESCRIPTION_MAX}
        showCounter
        error={err("description")}
        testID="report-description"
      />
      <View className="mt-3 flex-row gap-2">
        <TextField
          className="flex-1"
          label={t("report.color")}
          value={draft.color}
          onChangeText={(v) => update("color", v)}
          maxLength={40}
        />
        <TextField
          className="flex-1"
          label={t("report.collar")}
          value={draft.collar}
          onChangeText={(v) => update("collar", v)}
          maxLength={60}
        />
      </View>
      <TextField
        className="mt-3"
        label={t("report.marks")}
        value={draft.marks}
        onChangeText={(v) => update("marks", v)}
        maxLength={80}
      />

      {/* Comportamiento: define el perfil del círculo de vida (issue #10) */}
      {isLost ? (
        <View className="mt-6">
          <Text variant="subheading" accessibilityRole="header">
            {t("report.behavior")}
          </Text>
          <Text variant="caption">{t("report.behaviorHint")}</Text>
          <ToggleRow
            icon="flash-outline"
            tone="warning"
            title={t("report.traumatic")}
            description={t("report.traumaticHint")}
            value={draft.traumaticEvent}
            onChange={(v) => update("traumaticEvent", v)}
            testID="toggle-traumatic"
          />
          <ToggleRow
            icon="home-outline"
            tone="violet"
            title={t("report.shy")}
            description={t("report.shyHint")}
            value={draft.shyOrIndoor}
            onChange={(v) => update("shyOrIndoor", v)}
          />
        </View>
      ) : null}

      {/* Ubicación */}
      <Text variant="subheading" className="mb-3 mt-6" accessibilityRole="header">
        {isLost ? t("report.whereLost") : t("report.whereFound")}
      </Text>
      <TextField
        label={t("report.addressPlaceholder")}
        icon="location-outline"
        value={draft.zone}
        onChangeText={(v) => update("zone", v)}
        maxLength={80}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("report.useMyLocation")}
            accessibilityState={{ busy: locating }}
            onPress={() => void locateMe()}
            className="-mr-2 h-12 w-12 items-center justify-center"
            testID="use-my-location"
          >
            <Icon name="locate" size={22} color={colors.primaryStrong} />
          </Pressable>
        }
      />
      <View
        className={`mt-3 overflow-hidden rounded-3xl border-[1.5px] ${errors.hasLocation ? "border-danger" : "border-border"}`}
        accessibilityLabel={t("report.mapHint")}
      >
        <PetMap
          height={220}
          region={region}
          marker={draft.point ? { coordinate: draft.point, kind: draft.kind } : undefined}
          circles={draft.point ? [{ center: draft.point, radius: previewRadius, kind: draft.kind }] : []}
          onMapPress={(p) => void setPoint(p)}
          testID="report-map"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isLost ? t("report.lifeRadius") : t("report.searchRadius")}: ${formatDistance(previewRadius, locale)}`}
          onPress={() => setRadiusSheet(true)}
          className="absolute bottom-3 left-3 min-h-[52px] flex-row items-center gap-3 rounded-2xl bg-surface px-3 py-2 shadow-md shadow-black/15 active:opacity-80"
          testID="radius-pill"
        >
          <Icon name="radio-button-off" size={26} color={colors.primaryStrong} />
          <View>
            <Text variant="label" tone="muted">
              {isLost ? t("report.lifeRadius") : t("report.searchRadius")}
            </Text>
            <Text variant="subheading" tone="primary">
              {formatDistance(previewRadius, locale)}
            </Text>
            {isLost ? (
              <Text variant="label" tone="muted">
                {t("report.radiusGrows")}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-down" size={18} color={colors.ink} />
        </Pressable>
      </View>
      <Text
        variant="caption"
        tone={errors.hasLocation ? "danger" : "muted"}
        className="ml-1 mt-1"
        accessibilityLiveRegion="polite"
      >
        {errors.hasLocation ? err("hasLocation") : t("report.mapHint")}
      </Text>

      <View className="mt-3">
        <SelectField
          label={t("report.dateTime")}
          icon="time-outline"
          value={draft.when}
          options={whenOptions}
          onChange={(v) => update("when", v)}
        />
      </View>

      {/* Información adicional */}
      <Text variant="subheading" className="mt-6" accessibilityRole="header">
        {t("report.extra")}
      </Text>
      <Text variant="caption" className="mb-2">
        {t("report.extraHint")}
      </Text>
      {isLost ? (
        <ToggleRow
          icon="megaphone-outline"
          tone="primary"
          title={t("report.reward")}
          description={t("report.rewardHint")}
          value={draft.reward}
          onChange={(v) => update("reward", v)}
        />
      ) : (
        <View className="gap-3">
          <SelectField
            label={t("report.condition")}
            icon="medkit-outline"
            value={draft.condition}
            options={conditionOptions}
            onChange={(v) => update("condition", v)}
            sheetSubtitle={t("report.conditionHint")}
          />
          <SelectField
            label={t("report.custody")}
            icon="home-outline"
            value={draft.custody}
            options={custodyOptions}
            onChange={(v) => update("custody", v)}
            sheetSubtitle={t("report.custodyHint")}
          />
        </View>
      )}

      <View className="mt-6">
        <Button
          label={submitting ? t("report.publishing") : t("report.publish")}
          onPress={() => void publish()}
          loading={submitting}
          disabled={!allowance.allowed}
          testID="publish"
        />
      </View>
      <View className="mt-3 flex-row items-center justify-center gap-2">
        <Icon name="shield-checkmark-outline" size={16} color={colors.primaryStrong} />
        <Text variant="caption">{t("report.secure")}</Text>
      </View>

      <Sheet
        visible={photoSheet}
        onClose={() => setPhotoSheet(false)}
        title={isLost ? t("report.addPhoto") : t("report.addPhotos")}
      >
        <ListRow
          icon="camera-outline"
          title={t("report.takePhoto")}
          onPress={() => void addPhotos("camera")}
          testID="photo-camera"
        />
        <ListRow
          icon="images-outline"
          title={t("report.pickPhoto")}
          onPress={() => void addPhotos("library")}
          testID="photo-library"
        />
      </Sheet>

      <Sheet
        visible={radiusSheet}
        onClose={() => setRadiusSheet(false)}
        title={isLost ? t("report.projectionTitle") : t("report.searchRadius")}
        subtitle={isLost ? t("report.projectionBody", { profile: t(`profiles.${profile}`) }) : undefined}
      >
        {isLost ? (
          <View className="pb-3">
            <View className="flex-row items-center gap-4">
              <LifeCircleDiagram profile={profile} kind="lost" size={150} />
              <LifeCircleLegend profile={profile} />
            </View>
            <Text variant="caption" className="mt-3">
              {`${t("report.projectionCap", { distance: formatDistance(LIFE_CIRCLE_PROFILES[profile].cap, locale) })} · ~${Math.round(hoursToCap(profile))} h`}
            </Text>
          </View>
        ) : (
          <OptionList
            options={FOUND_RADIUS_OPTIONS.map((r) => ({ value: r, label: formatDistance(r, locale) }))}
            value={draft.foundRadius}
            onSelect={(r) => {
              update("foundRadius", r);
              setRadiusSheet(false);
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}
