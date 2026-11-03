import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Screen } from "@/components/layout";
import { AdoptionUpdates, PawFamilyHeader, ShelterTag } from "@/components/pawfamily";
import { PetPhoto, UserAvatar } from "@/components/pets";
import { Button } from "@/components/ui/Button";
import { Banner, Card, Chip, EmptyState, ListRow, SectionHeader } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ConfirmSheet, Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import type { AdoptionApplication, AdoptionReportReason } from "@/domain/adoption";
import { shortName } from "@/domain/privacy";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useI18n } from "@/i18n/I18nProvider";
import { adoptionView } from "@/services/selectors";
import { useBackend, useBackendState } from "@/store/backend";
import { useTheme } from "@/theme/ThemeProvider";

const REPORT_REASONS: AdoptionReportReason[] = ["money", "scam", "inappropriate", "other"];

/** Ficha de una mascota en adopción. Quien la publicó ve y responde las solicitudes. */
export default function AdoptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const backend = useBackend();
  const state = useBackendState();
  const toast = useToast();
  const requireAccount = useAuthGate();
  const adoption = id ? adoptionView(state, id) : undefined;
  const isOwner = Boolean(adoption && adoption.ownerId === state.sessionUserId);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirm, setConfirm] = useState<"adopted" | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void backend.loadAdoption(id).catch(() => {});
  }, [backend, id, state.adoptionVersion]);
  useEffect(() => {
    if (id && isOwner) void backend.loadAdoptionApplications(id).catch(() => {});
  }, [backend, id, isOwner, state.adoptionVersion]);

  if (!adoption) {
    return (
      <Screen header={<PawFamilyHeader back />}>
        <EmptyState icon="paw-outline" title={t("pawfamily.notFound")} />
      </Screen>
    );
  }

  const owner = state.users[adoption.ownerId];
  const listed = adoption.status === "available" || adoption.status === "in_process";
  const applications = state.adoptionApplications.filter((a) => a.adoptionId === adoption.id);
  const mine = applications.find((a) => a.applicantId === state.sessionUserId);
  const [cover, ...more] = adoption.photos;
  // Después de adoptar: quien adoptó cuenta cómo está y quien la dio lo ve.
  const adopted = adoption.status === "adopted";
  const iAdopted = adopted && (mine?.status ?? adoption.myApplication) === "accepted";

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
    } catch {
      toast(t("errors.unknown"), "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <Screen header={<PawFamilyHeader back />} testID="adoption-detail">
      {cover ? (
        <PetPhoto
          full
          pet={adoption}
          className="h-64 w-full"
          rounded="rounded-3xl"
          label={t("pet.photoOf", { name: adoption.name })}
        />
      ) : null}
      {more.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} className="mt-2">
          {more.map((uri) => (
            <Image key={uri} source={{ uri }} style={{ width: 88, height: 88, borderRadius: 16 }} contentFit="cover" />
          ))}
        </ScrollView>
      ) : null}

      <View className="mt-3 flex-row items-center gap-2">
        <Text variant="title" accessibilityRole="header" className="shrink">
          {adoption.name}
        </Text>
        {adoption.status !== "available" ? (
          <View className="rounded-full bg-surface-alt px-3 py-1">
            <Text variant="label">{t(`pawfamily.status_${adoption.status}`)}</Text>
          </View>
        ) : null}
      </View>
      <Text variant="body" tone="muted">
        {[t(`species.${adoption.species}`), adoption.breed].filter(Boolean).join(" · ")}
      </Text>

      <Card className="mt-3">
        <View className="flex-row flex-wrap">
          <Fact
            icon={adoption.sex === "female" ? "female" : adoption.sex === "male" ? "male" : "help"}
            label={t("pet.sex")}
            value={t(`sex.${adoption.sex}`)}
          />
          <Fact icon="paw-outline" label={t("pet.age")} value={t(`age.${adoption.age}`)} />
          <Fact icon="resize" label={t("pet.size")} value={t(`size.${adoption.size}`)} />
          {adoption.color ? <Fact icon="color-palette-outline" label={t("pet.color")} value={adoption.color} /> : null}
          <Fact
            icon="medkit-outline"
            label={t("pawfamily.vaccinated")}
            value={adoption.vaccinated ? t("pawfamily.yes") : t("pawfamily.no")}
          />
          <Fact
            icon="cut-outline"
            label={t("pawfamily.sterilized")}
            value={adoption.sterilized ? t("pawfamily.yes") : t("pawfamily.no")}
          />
        </View>
        <Text variant="body">{adoption.description}</Text>
        <View className="mt-3 flex-row items-center gap-1">
          <Icon name="location-outline" size={16} color={colors.muted} />
          <Text variant="caption">{adoption.zone}</Text>
        </View>
        {adoption.address ? (
          <View className="mt-1 flex-row items-center gap-1" testID="adoption-address">
            <Icon name="home-outline" size={16} color={colors.primaryStrong} />
            <Text variant="captionStrong">{adoption.address}</Text>
          </View>
        ) : null}
      </Card>

      {listed ? (
        <View className="mt-3">
          <Button
            variant="outline"
            icon="logo-instagram"
            label={t("pawfamily.shareStory")}
            onPress={() => router.push(`/pawfamily/historia/${adoption.id}`)}
            testID="adoption-share-story"
          />
        </View>
      ) : null}

      {adopted && (isOwner || iAdopted) ? <AdoptionUpdates adoptionId={adoption.id} canPost={iAdopted} /> : null}

      {owner ? (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/user/${owner.id}`)} className="mt-3 active:opacity-80">
          <Card>
            <View className="flex-row items-center gap-3">
              <UserAvatar user={owner} size={44} />
              <View className="flex-1">
                <Text variant="caption">{t("pawfamily.publishedBy")}</Text>
                <Text variant="bodyStrong">
                  {owner.shelterStatus === "verified" && owner.shelterName ? owner.shelterName : shortName(owner.name)}
                </Text>
                {owner.shelterStatus === "verified" ? <ShelterTag /> : null}
              </View>
              <Icon name="chevron-forward" size={20} color={colors.muted} />
            </View>
          </Card>
        </Pressable>
      ) : null}

      {isOwner ? (
        <OwnerPanel
          applications={applications}
          listed={listed}
          busy={busy}
          onAccept={(application) =>
            void run(async () => {
              const threadId = await backend.acceptApplication(application.id);
              router.push(`/chat/${threadId}`);
            })
          }
          onDecline={(application) => void run(() => backend.declineApplication(application.id), t("pawfamily.declined"))}
          onAdopted={() => setConfirm("adopted")}
          onWithdraw={() => setConfirm("withdraw")}
        />
      ) : (
        <View className="mt-4 gap-3">
          {(mine ?? adoption.myApplication) ? (
            <Banner
              icon={(mine?.status ?? adoption.myApplication) === "accepted" ? "checkmark-circle-outline" : "time-outline"}
              body={t(`pawfamily.my_${mine?.status ?? adoption.myApplication ?? "pending"}`)}
              action={
                mine?.threadId ? (
                  <Button compact label={t("pawfamily.openChat")} onPress={() => router.push(`/chat/${mine.threadId}`)} />
                ) : undefined
              }
            />
          ) : listed ? (
            <Button
              icon="heart"
              label={t("pawfamily.apply")}
              onPress={() => {
                if (requireAccount(`/pawfamily/${adoption.id}`)) router.push(`/pawfamily/postular/${adoption.id}`);
              }}
              testID="adoption-apply"
            />
          ) : null}
          <Banner icon="cash-outline" tone="warning" body={t("pawfamily.freeNotice")} />
          <Card>
            <ListRow
              icon="flag-outline"
              danger
              title={t("pawfamily.report")}
              onPress={() => {
                if (requireAccount(`/pawfamily/${adoption.id}`)) setReportOpen(true);
              }}
              testID="adoption-report"
            />
          </Card>
        </View>
      )}

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        onSend={(reason) =>
          run(() => backend.reportAdoption(adoption.id, reason), t("pawfamily.reportSent")).then(() => setReportOpen(false))
        }
      />
      <ConfirmSheet
        visible={confirm !== null}
        danger={confirm === "withdraw"}
        loading={busy}
        title={t(confirm === "adopted" ? "pawfamily.adoptedTitle" : "pawfamily.withdrawTitle", { name: adoption.name })}
        body={t(confirm === "adopted" ? "pawfamily.adoptedBody" : "pawfamily.withdrawBody")}
        confirmLabel={t(confirm === "adopted" ? "pawfamily.markAdopted" : "pawfamily.withdraw")}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          void run(
            async () => {
              if (confirm === "adopted") await backend.markAdopted(adoption.id);
              else {
                await backend.withdrawAdoption(adoption.id);
                router.replace("/pawfamily/mias");
              }
            },
            t(confirm === "adopted" ? "pawfamily.adoptedDone" : "pawfamily.withdrawDone"),
          )
        }
      />
    </Screen>
  );
}

function OwnerPanel({
  applications,
  listed,
  busy,
  onAccept,
  onDecline,
  onAdopted,
  onWithdraw,
}: {
  applications: AdoptionApplication[];
  listed: boolean;
  busy: boolean;
  onAccept: (a: AdoptionApplication) => void;
  onDecline: (a: AdoptionApplication) => void;
  onAdopted: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useI18n();
  const state = useBackendState();
  return (
    <View className="mt-4 gap-3">
      <Card>
        <SectionHeader title={t("pawfamily.requests", { count: applications.length })} />
        {applications.length === 0 ? (
          <Text variant="caption">{t("pawfamily.noRequests")}</Text>
        ) : (
          applications.map((a) => {
            const applicant = state.users[a.applicantId];
            return (
              <View key={a.id} className="mb-3 gap-1 border-b border-border pb-3" testID={`application-${a.id}`}>
                <View className="flex-row items-center gap-3">
                  {applicant ? <UserAvatar user={applicant} size={40} /> : null}
                  <View className="flex-1">
                    <Text variant="bodyStrong">{a.fullName}</Text>
                    <Text variant="caption">{`${a.neighborhood}, ${a.city}`}</Text>
                  </View>
                  <Text variant="label">{t(`pawfamily.app_${a.status}`)}</Text>
                </View>
                <Text variant="caption">{t("pawfamily.household", { count: a.household })}</Text>
                <Text variant="caption">
                  {a.hadPets ? t("pawfamily.hadPets", { count: a.petsCount }) : t("pawfamily.noPetsBefore")}
                </Text>
                <Text variant="body">{a.reason}</Text>
                {a.status === "pending" && listed ? (
                  <View className="mt-1 flex-row gap-2">
                    <Button
                      compact
                      label={t("pawfamily.accept")}
                      disabled={busy}
                      onPress={() => onAccept(a)}
                      testID={`accept-${a.id}`}
                    />
                    <Button
                      compact
                      variant="ghost"
                      label={t("pawfamily.decline")}
                      disabled={busy}
                      onPress={() => onDecline(a)}
                      testID={`decline-${a.id}`}
                    />
                  </View>
                ) : null}
                {a.status === "accepted" && a.threadId ? (
                  <Button
                    compact
                    variant="outline"
                    label={t("pawfamily.openChat")}
                    onPress={() => router.push(`/chat/${a.threadId}`)}
                  />
                ) : null}
              </View>
            );
          })
        )}
      </Card>
      {listed ? (
        <View className="gap-2">
          <Button icon="home" label={t("pawfamily.markAdopted")} onPress={onAdopted} testID="adoption-adopted" />
          <Button variant="ghost" label={t("pawfamily.withdraw")} onPress={onWithdraw} testID="adoption-withdraw" />
        </View>
      ) : null}
    </View>
  );
}

function ReportSheet({
  visible,
  onClose,
  onSend,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (reason: AdoptionReportReason) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<AdoptionReportReason | null>(null);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("pawfamily.report")}
      subtitle={t("pawfamily.reportHint")}
      testID="adoption-report-sheet"
    >
      <View className="mb-4 flex-row flex-wrap gap-2">
        {REPORT_REASONS.map((r) => (
          <Chip
            key={r}
            label={t(`pawfamily.reason_${r}`)}
            selected={reason === r}
            onPress={() => setReason(r)}
            testID={`reason-${r}`}
          />
        ))}
      </View>
      <Button
        label={t("pawfamily.reportSend")}
        disabled={!reason}
        onPress={() => {
          if (reason) void onSend(reason).then(() => setReason(null));
        }}
        testID="adoption-report-send"
      />
    </Sheet>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View className="mb-3 w-1/2 flex-row gap-2 pr-2" accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={18} color={colors.primaryStrong} />
      <View className="flex-1">
        <Text variant="caption">{label}</Text>
        <Text variant="bodyStrong">{value}</Text>
      </View>
    </View>
  );
}
