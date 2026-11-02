import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Screen } from "@/components/layout";
import { AdoptionCard, PawFamilyBrand, PawFamilyHeader, ShelterTag } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner, Card, Checkbox, Chip, EmptyState, ListRow } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { ADOPTION_RADII, DEFAULT_ADOPTION_FILTERS, type AdoptionFilters } from "@/domain/adoption";
import { distanceMeters } from "@/domain/geo";
import { useAuthGate } from "@/hooks/useAuthGate";
import { cityFromPoint } from "@/hooks/usePlacePicker";
import { useI18n } from "@/i18n/I18nProvider";
import { adoptionView } from "@/services/selectors";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";
import { useBackend, useBackendState, useCurrentUser } from "@/store/backend";
import { useUserLocation } from "@/store/location";
import { useTheme } from "@/theme/ThemeProvider";

export type PawFamilyRole = "person" | "shelter";

/**
 * PawFamily: adopción responsable y gratuita. Al entrar se aceptan las políticas y se elige cómo
 * usarla: una persona natural busca mascotas y también puede dar en adopción; un refugio,
 * verificado con su NIT, publica sus mascotas y responde solicitudes.
 */
export default function PawFamilyScreen() {
  const user = useCurrentUser();
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [role, setRole] = useState<PawFamilyRole | null | undefined>(undefined);
  const isShelter = user?.shelterStatus === "verified";

  useEffect(() => {
    void Promise.all([readJSON<boolean>(STORAGE_KEYS.pawfamilyTerms), readJSON<PawFamilyRole>(STORAGE_KEYS.pawfamilyRole)])
      .then(([terms, saved]) => {
        setAccepted(Boolean(terms));
        setRole(saved ?? null);
      })
      .catch(() => {
        setAccepted(false);
        setRole(null);
      });
  }, []);

  const choose = useCallback((next: PawFamilyRole | null) => {
    setRole(next);
    void writeJSON(STORAGE_KEYS.pawfamilyRole, next);
  }, []);

  if (accepted === null || role === undefined) return <Screen header={<PawFamilyHeader />}>{null}</Screen>;
  if (!accepted) return <Terms onAccept={() => setAccepted(true)} />;
  // Un refugio verificado entra directo a su panel; si perdió la verificación, vuelve a elegir.
  const current = role ?? (isShelter ? "shelter" : null);
  if (current === "shelter" && isShelter) return <ShelterHub onChangeRole={() => choose("person")} />;
  if (current === "person") return <PersonHub onChangeRole={() => choose(null)} />;
  return <RoleChoice onPerson={() => choose("person")} />;
}

/** Políticas de PawFamily: hay que aceptarlas antes de entrar. */
function Terms({ onAccept }: { onAccept: () => void }) {
  const { t } = useI18n();
  const backend = useBackend();
  const user = useCurrentUser();
  const [checked, setChecked] = useState(false);
  const points = ["pawfamily.termsFree", "pawfamily.termsTruth", "pawfamily.termsReport", "pawfamily.termsDecision"] as const;
  return (
    <Screen header={<PawFamilyHeader />} testID="pawfamily-terms">
      <View className="items-center gap-2">
        <PawFamilyBrand size={30} />
        <Text variant="title" className="mt-3 text-center" accessibilityRole="header">
          {t("pawfamily.termsTitle")}
        </Text>
        <Text variant="body" tone="muted" className="text-center">
          {t("pawfamily.termsIntro")}
        </Text>
      </View>
      <Card className="mt-5">
        <View className="gap-3">
          {points.map((key) => (
            <View key={key} className="flex-row gap-3">
              <Text variant="bodyStrong">•</Text>
              <Text variant="body" className="flex-1">
                {t(key)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      <View className="mt-5">
        <Checkbox checked={checked} onChange={setChecked} label={t("pawfamily.termsAccept")} testID="pawfamily-terms-check" />
      </View>
      <View className="mt-4">
        <Button
          label={t("pawfamily.termsContinue")}
          disabled={!checked}
          onPress={() => {
            void writeJSON(STORAGE_KEYS.pawfamilyTerms, true);
            if (user) void backend.acceptAdoptionTerms().catch(() => {});
            onAccept();
          }}
          testID="pawfamily-terms-accept"
        />
      </View>
    </Screen>
  );
}

/** ¿Persona natural o refugio? Define lo que se muestra al entrar. */
function RoleChoice({ onPerson }: { onPerson: () => void }) {
  const { t } = useI18n();
  const requireAccount = useAuthGate();
  return (
    <Screen header={<PawFamilyHeader />} testID="pawfamily-role">
      <Text variant="title" className="text-center" accessibilityRole="header">
        {t("pawfamily.roleTitle")}
      </Text>
      <Text variant="body" tone="muted" className="mt-1 text-center">
        {t("pawfamily.roleIntro")}
      </Text>
      <View className="mt-5 gap-3">
        <RoleCard
          icon="person-outline"
          title={t("pawfamily.rolePerson")}
          body={t("pawfamily.rolePersonBody")}
          onPress={onPerson}
          testID="role-person"
        />
        <RoleCard
          icon="business-outline"
          title={t("pawfamily.roleShelter")}
          body={t("pawfamily.roleShelterBody")}
          onPress={() => {
            if (requireAccount("/pawfamily/refugio")) router.push("/pawfamily/refugio");
          }}
          testID="role-shelter"
        />
      </View>
    </Screen>
  );
}

function RoleCard({
  icon,
  title,
  body,
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      className="flex-row items-center gap-4 rounded-3xl border border-border/60 bg-surface p-5 active:opacity-80"
      testID={testID}
    >
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
        <Icon name={icon} size={28} color={colors.primaryStrong} />
      </View>
      <View className="flex-1 gap-1">
        <Text variant="subheading">{title}</Text>
        <Text variant="caption" tone="body">
          {body}
        </Text>
      </View>
      <Icon name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** Persona natural: mascotas cerca para adoptar, y también puede dar en adopción. */
function PersonHub({ onChangeRole }: { onChangeRole: () => void }) {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const requireAccount = useAuthGate();
  const { location } = useUserLocation();
  const [filters, setFilters] = useState<AdoptionFilters>(DEFAULT_ADOPTION_FILTERS);
  const [wholeCity, setWholeCity] = useState(false);
  const [city, setCity] = useState<string | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const profileCity = user?.city;

  useEffect(() => {
    let live = true;
    void cityFromPoint(location).then((found) => {
      if (live) setCity(found ?? (profileCity || null));
    });
    return () => {
      live = false;
    };
  }, [location, profileCity]);

  const query = useMemo(() => ({ ...filters, city: wholeCity && city ? city : undefined }), [filters, wholeCity, city]);
  useEffect(() => {
    let live = true;
    backend
      .loadAdoptions(location, query)
      .then((list) => {
        if (live) setIds(list);
      })
      .catch(() => {
        if (live) setIds([]);
      });
    return () => {
      live = false;
    };
  }, [backend, location, query, state.adoptionVersion]);

  const set = <K extends keyof AdoptionFilters>(key: K, value: AdoptionFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? undefined : value }));
  const clear = (key: "species" | "sex" | "size" | "age") => setFilters((f) => ({ ...f, [key]: undefined }));
  const filtering =
    wholeCity ||
    filters.radiusKm !== DEFAULT_ADOPTION_FILTERS.radiusKm ||
    Boolean(filters.species || filters.sex || filters.size || filters.age);
  const list = (ids ?? []).map((id) => adoptionView(state, id)).filter((a) => a !== undefined);

  return (
    <Screen header={<PawFamilyHeader />} testID="pawfamily">
      <Banner icon="heart-outline" body={t("pawfamily.freeBanner")} />
      <View className="mt-3 gap-2">
        <Button
          icon="add"
          label={t("pawfamily.publish")}
          onPress={() => {
            if (requireAccount("/pawfamily/publicar")) router.push("/pawfamily/publicar");
          }}
          testID="pawfamily-publish"
        />
        {user ? (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button compact variant="outline" label={t("pawfamily.mine")} onPress={() => router.push("/pawfamily/mias")} />
            </View>
            <View className="flex-1">
              <Button
                compact
                variant="outline"
                label={t("pawfamily.myRequests")}
                onPress={() => router.push("/pawfamily/solicitudes")}
              />
            </View>
          </View>
        ) : null}
      </View>

      {/* Filtros: cada categoría por separado y a la vista, para combinarlas. */}
      <Card className="mt-4" testID="adoption-filters">
        <View className="flex-row items-center justify-between">
          <Text variant="subheading" accessibilityRole="header">
            {t("pawfamily.filters")}
          </Text>
          {filtering ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFilters(DEFAULT_ADOPTION_FILTERS);
                setWholeCity(false);
              }}
              className="min-h-[44px] justify-center px-2 active:opacity-70"
              testID="filters-clear"
            >
              <Text variant="captionStrong" tone="primary">
                {t("pawfamily.clearFilters")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <FilterGroup label={t("pawfamily.distance")}>
          {ADOPTION_RADII.map((km) => (
            <Chip
              key={km}
              label={t("pawfamily.km", { count: km })}
              selected={!wholeCity && filters.radiusKm === km}
              onPress={() => {
                setWholeCity(false);
                setFilters((f) => ({ ...f, radiusKm: km }));
              }}
              testID={`radius-${km}`}
            />
          ))}
          {city ? (
            <Chip
              label={t("pawfamily.wholeCity", { city })}
              selected={wholeCity}
              onPress={() => setWholeCity((v) => !v)}
              testID="whole-city"
            />
          ) : null}
        </FilterGroup>
        <FilterGroup label={t("pawfamily.animal")}>
          <Chip
            label={t("pawfamily.all")}
            selected={!filters.species}
            onPress={() => clear("species")}
            testID="filter-species-all"
          />
          {(["dog", "cat", "other"] as const).map((species) => (
            <Chip
              key={species}
              label={t(`species.${species}`)}
              selected={filters.species === species}
              onPress={() => set("species", species)}
              testID={`filter-${species}`}
            />
          ))}
        </FilterGroup>
        <FilterGroup label={t("pet.sex")}>
          <Chip label={t("pawfamily.all")} selected={!filters.sex} onPress={() => clear("sex")} testID="filter-sex-all" />
          <Chip
            label={t("pawfamily.female")}
            selected={filters.sex === "female"}
            onPress={() => set("sex", "female")}
            testID="filter-female"
          />
          <Chip
            label={t("pawfamily.male")}
            selected={filters.sex === "male"}
            onPress={() => set("sex", "male")}
            testID="filter-male"
          />
        </FilterGroup>
        <FilterGroup label={t("pet.size")}>
          <Chip label={t("pawfamily.all")} selected={!filters.size} onPress={() => clear("size")} testID="filter-size-all" />
          {(["small", "medium", "large"] as const).map((size) => (
            <Chip
              key={size}
              label={t(`size.${size}`)}
              selected={filters.size === size}
              onPress={() => set("size", size)}
              testID={`filter-${size}`}
            />
          ))}
        </FilterGroup>
        <FilterGroup label={t("pet.age")} last>
          <Chip label={t("pawfamily.all")} selected={!filters.age} onPress={() => clear("age")} testID="filter-age-all" />
          {(["puppy", "young", "adult", "senior"] as const).map((age) => (
            <Chip
              key={age}
              label={t(`age.${age}`)}
              selected={filters.age === age}
              onPress={() => set("age", age)}
              testID={`filter-${age}`}
            />
          ))}
        </FilterGroup>
      </Card>

      <View className="mt-4">
        {ids === null ? (
          <Text variant="caption">{t("pawfamily.loading")}</Text>
        ) : list.length === 0 ? (
          <EmptyState icon="paw-outline" title={t("pawfamily.empty")} body={t("pawfamily.emptyHint")} />
        ) : (
          list.map((adoption) => (
            <AdoptionCard key={adoption.id} adoption={adoption} distanceMeters={distanceMeters(location, adoption.location)} />
          ))
        )}
      </View>

      <Card className="mt-2">
        <ListRow icon="swap-horizontal-outline" title={t("pawfamily.changeRole")} onPress={onChangeRole} testID="change-role" />
      </Card>
    </Screen>
  );
}

/** Refugio verificado: publica sus mascotas y responde las solicitudes. */
function ShelterHub({ onChangeRole }: { onChangeRole: () => void }) {
  const { t } = useI18n();
  const backend = useBackend();
  const state = useBackendState();
  const user = useCurrentUser();
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    backend
      .loadMyAdoptions()
      .then((list) => {
        if (live) setIds(list);
      })
      .catch(() => {
        if (live) setIds([]);
      });
    return () => {
      live = false;
    };
  }, [backend, state.adoptionVersion]);

  const list = (ids ?? []).map((id) => adoptionView(state, id)).filter((a) => a !== undefined);
  const pending = list.reduce((sum, a) => sum + (a.pending ?? 0), 0);
  const adopted = list.filter((a) => a.status === "adopted").length;

  return (
    <Screen header={<PawFamilyHeader />} testID="pawfamily-shelter">
      <Card>
        <View className="gap-2">
          <ShelterTag />
          <Text variant="title" accessibilityRole="header">
            {user?.shelterName}
          </Text>
          <View className="mt-1 flex-row">
            <Stat value={list.length} label={t("pawfamily.statPosts")} />
            <Stat value={pending} label={t("pawfamily.statPending")} />
            <Stat value={adopted} label={t("pawfamily.statAdopted")} />
          </View>
        </View>
      </Card>
      <View className="mt-3">
        <Button
          icon="add"
          label={t("pawfamily.publishShelter")}
          onPress={() => router.push("/pawfamily/publicar")}
          testID="shelter-publish"
        />
      </View>
      <View className="mt-3">
        <Banner icon="mail-outline" body={t("pawfamily.spamNote")} />
      </View>
      <Text variant="subheading" className="mb-2 mt-5" accessibilityRole="header">
        {t("pawfamily.shelterPosts")}
      </Text>
      {ids !== null && list.length === 0 ? (
        <EmptyState icon="paw-outline" title={t("pawfamily.shelterEmpty")} />
      ) : (
        list.map((adoption) => (
          <View key={adoption.id}>
            <AdoptionCard adoption={adoption} />
            {adoption.pending ? (
              <Text variant="captionStrong" tone="primary" className="-mt-2 mb-3 ml-2">
                {t("pawfamily.pendingCount", { count: adoption.pending })}
              </Text>
            ) : null}
          </View>
        ))
      )}
      <Card className="mt-2">
        <ListRow
          icon="swap-horizontal-outline"
          title={t("pawfamily.changeToPerson")}
          onPress={onChangeRole}
          testID="change-role"
        />
      </Card>
    </Screen>
  );
}

/** Un grupo de filtros con su título; las opciones se acomodan en varias líneas, siempre visibles. */
function FilterGroup({ label, last, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <View className={last ? "mt-3" : "mt-3 border-b border-border pb-3"}>
      <Text variant="captionStrong" className="mb-2">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 items-center" accessible accessibilityLabel={`${value} ${label}`}>
      <Text variant="heading">{String(value)}</Text>
      <Text variant="caption" className="text-center">
        {label}
      </Text>
    </View>
  );
}
