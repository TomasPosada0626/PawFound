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
import { useI18n } from "@/i18n/I18nProvider";
import { BackendError } from "@/services/backendTypes";
import { userBadgeProgress, userStats } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const TITLES: ProfileTitle[] = ["animal_lover", "rescuer", "neighbor", "volunteer", "foster"];

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

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/settings/edit-profile" } }} />;
  const stats = userStats(state, user.id);
  const badges = userBadgeProgress(state, user.id).filter((b) => b.tier > 0);

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
          <AvatarGlyph avatar={avatar} size={104} />
        </View>
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
        <Text variant="caption" className="mt-2 text-center">
          {t("editProfile.photoSoon")}
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
