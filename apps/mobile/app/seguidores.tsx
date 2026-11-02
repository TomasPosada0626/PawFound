import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppHeader, BackButton, Screen } from "@/components/layout";
import { PersonRow } from "@/components/PersonRow";
import { Button } from "@/components/ui/Button";
import { Banner, Chip, EmptyState, ListRow } from "@/components/ui/Controls";
import { ConfirmSheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { shortName } from "@/domain/privacy";
import type { User } from "@/domain/types";
import { useI18n } from "@/i18n/I18nProvider";
import { networkOf } from "@/services/selectors";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";

type Tab = "requests" | "followers" | "following";
type Pending = { kind: "remove" | "unfollow"; person: User };

/** La red de la propia cuenta. Nadie más puede verla: en el perfil solo se muestra el número. */
export default function FollowersScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const toast = useToast();
  const network = networkOf(state);
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab | null>(params.tab ?? null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    if (userId) void backend.loadNetwork().catch(() => {});
  }, [backend, userId]);

  if (!user) return <Redirect href={{ pathname: "/auth/login", params: { next: "/seguidores" } }} />;

  const people = (ids: string[]) => ids.map((id) => state.users[id]).filter((p): p is User => Boolean(p));
  // Si hay solicitudes es lo primero que importa ver.
  const current = tab ?? (network.requests.length ? "requests" : "followers");

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
    } catch {
      toast(t("errors.unknown"), "error");
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const requests = people(network.requests);
  const followers = people(network.followers);
  const following = people(network.following);
  const sent = people(network.sent);
  const name = pending ? shortName(pending.person.name) : "";

  return (
    <Screen header={<AppHeader left={<BackButton />} title={t("network.title")} />} testID="followers-screen">
      <ListRow
        icon="search-outline"
        tone="blue"
        title={t("network.search")}
        onPress={() => router.push("/buscar-personas")}
        testID="open-search"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} className="my-3 grow-0">
        <Chip
          label={t("network.tabRequests", { count: requests.length })}
          selected={current === "requests"}
          onPress={() => setTab("requests")}
          testID="tab-requests"
        />
        <Chip
          label={t("network.tabFollowers", { count: followers.length })}
          selected={current === "followers"}
          onPress={() => setTab("followers")}
          testID="tab-followers"
        />
        <Chip
          label={t("network.tabFollowing", { count: following.length + sent.length })}
          selected={current === "following"}
          onPress={() => setTab("following")}
          testID="tab-following"
        />
      </ScrollView>

      {current === "requests" ? (
        requests.length === 0 ? (
          <EmptyState icon="person-add-outline" title={t("network.emptyRequests")} />
        ) : (
          requests.map((person) => (
            <PersonRow key={person.id} person={person}>
              <View className="gap-1">
                <Button
                  compact
                  label={t("network.accept")}
                  disabled={busy}
                  onPress={() =>
                    void run(() => backend.acceptFollower(person.id), t("network.accepted", { name: shortName(person.name) }))
                  }
                  testID={`accept-${person.id}`}
                />
                <Button
                  compact
                  variant="ghost"
                  label={t("network.decline")}
                  disabled={busy}
                  onPress={() => void run(() => backend.removeFollower(person.id))}
                  testID={`decline-${person.id}`}
                />
              </View>
            </PersonRow>
          ))
        )
      ) : null}

      {current === "followers" ? (
        followers.length === 0 ? (
          <EmptyState icon="people-outline" title={t("network.emptyFollowers")} />
        ) : (
          followers.map((person) => (
            <PersonRow key={person.id} person={person}>
              <Button
                compact
                variant="outline"
                label={t("network.remove")}
                onPress={() => setPending({ kind: "remove", person })}
                testID={`remove-${person.id}`}
              />
            </PersonRow>
          ))
        )
      ) : null}

      {current === "following" ? (
        following.length + sent.length === 0 ? (
          <EmptyState icon="people-outline" title={t("network.emptyFollowing")} />
        ) : (
          <>
            {following.map((person) => (
              <PersonRow key={person.id} person={person}>
                <Button
                  compact
                  variant="outline"
                  label={t("network.unfollow")}
                  onPress={() => setPending({ kind: "unfollow", person })}
                  testID={`unfollow-${person.id}`}
                />
              </PersonRow>
            ))}
            {sent.map((person) => (
              <PersonRow key={person.id} person={person}>
                <Button
                  compact
                  variant="ghost"
                  label={t("network.cancelRequest")}
                  disabled={busy}
                  onPress={() => void run(() => backend.unfollowUser(person.id))}
                  testID={`cancel-${person.id}`}
                />
              </PersonRow>
            ))}
          </>
        )
      ) : null}

      <View className="mt-4">
        <Banner icon="lock-closed-outline" body={t("network.privateNote")} />
      </View>

      <ConfirmSheet
        visible={Boolean(pending)}
        danger
        loading={busy}
        title={t(pending?.kind === "remove" ? "network.removeTitle" : "network.unfollowTitle", { name })}
        body={t(pending?.kind === "remove" ? "network.removeBody" : "network.unfollowBody")}
        confirmLabel={t(pending?.kind === "remove" ? "network.remove" : "network.unfollow")}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          const { kind, person } = pending;
          void run(() => (kind === "remove" ? backend.removeFollower(person.id) : backend.unfollowUser(person.id)));
        }}
      />
    </Screen>
  );
}
