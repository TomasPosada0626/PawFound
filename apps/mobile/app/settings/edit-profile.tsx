import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { BadgeTile } from "@/components/badges";
import { AVATAR_IDS, AvatarGlyph } from "@/components/pets";
import { SettingsCard, SettingsLayout } from "@/components/SettingsLayout";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SelectField } from "@/components/ui/SelectField";
import { cn, Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { useToast } from "@/components/ui/Toast";
import type { AvatarId, ProfileTitle } from "@/domain/types";
import { BIO_MAX } from "@/domain/validation";
import { errorMessage } from "@/features/errorMessages";
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { userBadgeProgress, userStats } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const TITLES: ProfileTitle[] = [
  "animal_lover",
  "rescuer",
  "neighbor",
  "volunteer",
  "foster",
  "dog_family",
  "cat_family",
  "paw_angel",
  "treat_fan",
  "furry_heart",
];

export default function EditProfileScreen() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();

  const [avatar, setAvatar] = useState<AvatarId>(user?.avatar ?? "dog");
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [title, setTitle] = useState<ProfileTitle>(user?.title ?? "animal_lover");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [city, setCity] = useState(user?.city ?? "");
  const [neighborhood, setNeighborhood] = useState(user?.neighborhood ?? "");
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/settings/edit-profile" } }} />;
  const stats = userStats(state, user.id);
  const badges = userBadgeProgress(state, user.id).filter((b) => b.tier > 0);

  // La foto se guarda en cuanto se elige (no espera a "Guardar"): así se ve al instante.
  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast(t("report.photoPermission"), "error");
      return;
    }
    // exif: false — no se leen metadatos (GPS) en la app; el servidor además los quita.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    await changePhoto(result.assets[0].uri);
  };

  const changePhoto = async (uri: string | null) => {
    setPhotoBusy(true);
    try {
      await backend.setProfilePhoto(uri);
      toast(uri ? t("editProfile.photoUploaded") : t("editProfile.photoRemoved"));
    } catch (e) {
      toast(errorMessage(e instanceof BackendError ? e.code : "unknown", t), "error");
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setUsernameError(undefined);
    try {
      await backend.updateProfile({ avatar, name: name.trim() || user.name, username, title, bio, city, neighborhood });
      toast(t("editProfile.saved"));
    } catch (e) {
      const code = e instanceof BackendError ? e.code : "unknown";
      if (code === "invalid_username" || code === "username_taken") setUsernameError(t(`errors.${code}`));
      else toast(t("errors.unknown"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsLayout section="personal" title={t("profile.editProfile")}>
      <SettingsCard title={t("editProfile.photoTitle")} subtitle={t("editProfile.photoSubtitle")}>
        <View className="items-center">
          {user.photoUrl ? (
            <Image
              source={{ uri: user.photoUrl }}
              style={{ width: 104, height: 104, borderRadius: 52 }}
              contentFit="cover"
              accessibilityLabel={t("editProfile.photoTitle")}
            />
          ) : (
            <AvatarGlyph avatar={avatar} size={104} />
          )}
        </View>
        <View className="mt-3 flex-row gap-2">
          <View className="flex-1">
            <Button
              label={user.photoUrl ? t("editProfile.changePhoto") : t("editProfile.uploadPhoto")}
              icon="camera-outline"
              variant="soft"
              compact
              loading={photoBusy}
              onPress={() => void pickPhoto()}
              testID="upload-profile-photo"
            />
          </View>
          {user.photoUrl ? (
            <View className="flex-1">
              <Button
                label={t("editProfile.removePhoto")}
                icon="trash-outline"
                variant="outline"
                compact
                disabled={photoBusy}
                onPress={() => void changePhoto(null)}
                testID="remove-profile-photo"
              />
            </View>
          ) : null}
        </View>
        <Text variant="label" tone="muted" className="mt-4">
          {user.photoUrl ? t("editProfile.avatarFallback") : t("editProfile.orAvatar")}
        </Text>
        <View accessibilityRole="radiogroup" className="mt-3 flex-row flex-wrap justify-center gap-2">
          {AVATAR_IDS.map((id) => {
            const selected = id === avatar;
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityLabel={t(`avatars.${id}`)}
                accessibilityState={{ checked: selected }}
                onPress={() => setAvatar(id)}
                className={cn("rounded-2xl border-2 p-1", selected ? "border-primary-strong" : "border-transparent")}
                testID={`avatar-${id}`}
              >
                <AvatarGlyph avatar={id} size={52} />
                {selected ? (
                  <View className="absolute bottom-0 right-0 h-5 w-5 items-center justify-center rounded-full bg-primary-strong">
                    <Icon name="checkmark" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" className="mt-3 text-center">
          {t("editProfile.photoVisible")}
        </Text>
      </SettingsCard>

      <SettingsCard title={t("editProfile.basicInfo")}>
        <View className="gap-3">
          <TextField label={t("editProfile.name")} value={name} onChangeText={setName} maxLength={60} testID="edit-name" />
          <TextField
            label={t("editProfile.username")}
            value={username}
            onChangeText={(v) => {
              setUsername(v);
              setUsernameError(undefined);
            }}
            autoCapitalize="none"
            error={usernameError}
            maxLength={21}
            testID="edit-username"
          />
          <SelectField
            label={t("editProfile.title")}
            icon="paw"
            value={title}
            options={TITLES.map((v) => ({ value: v, label: t(`titles.${v}`) }))}
            onChange={setTitle}
          />
          <TextField
            label={t("editProfile.bio")}
            value={bio}
            onChangeText={setBio}
            multiline
            maxLength={BIO_MAX}
            showCounter
            testID="edit-bio"
          />
        </View>
      </SettingsCard>

      <SettingsCard title={t("editProfile.location")}>
        <View className="gap-3">
          <TextField label={t("editProfile.city")} icon="location-outline" value={city} onChangeText={setCity} maxLength={40} />
          <TextField label={t("editProfile.neighborhood")} value={neighborhood} onChangeText={setNeighborhood} maxLength={40} />
        </View>
        <View className="mt-2 flex-row items-center gap-2">
          <Icon name="lock-closed-outline" size={14} color={colors.muted} />
          <Text variant="caption" className="flex-1">
            {t("editProfile.locationPrivacy")}
          </Text>
        </View>
      </SettingsCard>

      <SettingsCard title={t("editProfile.reputation")} subtitle={t("editProfile.reputationBody")}>
        <View className="flex-row items-center gap-2 rounded-2xl border border-border p-3">
          <Icon name="star" size={22} color="#F5A524" />
          {stats.ratingAvg !== null ? (
            <>
              <Text variant="heading">{stats.ratingAvg.toLocaleString(locale)}</Text>
              <Text variant="caption">{t("profile.ratingCount", { count: stats.ratingCount })}</Text>
              <View className="rounded-full bg-primary-soft px-2 py-0.5">
                <Text variant="label" tone="primary">
                  {stats.ratingAvg >= 4.5 ? t("editProfile.excellent") : t("editProfile.good")}
                </Text>
              </View>
            </>
          ) : (
            <Text variant="caption">{t("profile.noRatings")}</Text>
          )}
        </View>
      </SettingsCard>

      <SettingsCard title={t("profile.badges")}>
        {badges.length === 0 ? (
          <Text variant="caption">{t("profile.noBadges")}</Text>
        ) : (
          <View className="flex-row flex-wrap">
            {badges.map((b) => (
              <BadgeTile key={b.id} progress={b} size={48} />
            ))}
          </View>
        )}
      </SettingsCard>

      <Button label={t("editProfile.save")} onPress={() => void save()} loading={saving} testID="save-profile" />
    </SettingsLayout>
  );
}
