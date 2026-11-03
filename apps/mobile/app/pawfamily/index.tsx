import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Screen } from "@/components/layout";
import { AdoptionCard, PawFamilyBrand, PawFamilyHeader, ShelterTag } from "@/components/pawfamily";
import { Button } from "@/components/ui/Button";
import { Banner, Card, Checkbox, EmptyState, ListRow, ToggleRow } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { colors } = useTheme();
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

  // Cada categoría es de una sola opción: "Todos" (undefined) la quita.
  const setFilter = <K extends "species" | "sex" | "size" | "age">(key: K, value: AdoptionFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const reset = () => {
    setFilters(DEFAULT_ADOPTION_FILTERS);
    setWholeCity(false);
  };
  const distanceChanged = wholeCity || filters.radiusKm !== DEFAULT_ADOPTION_FILTERS.radiusKm;
  const pills = [
    filters.species ? { key: "species", label: t(`species.${filters.species}`) } : null,
    filters.sex ? { key: "sex", label: t(filters.sex === "female" ? "pawfamily.female" : "pawfamily.male") } : null,
    filters.size ? { key: "size", label: t(`size.${filters.size}`) } : null,
    filters.age ? { key: "age", label: t(`ageShort.${filters.age}`) } : null,
  ]
    .filter((p): p is { key: "species" | "sex" | "size" | "age"; label: string } => p !== null)
    .map((p) => ({ ...p, onRemove: () => setFilter(p.key, undefined) }));
  const activeCount = pills.length + (distanceChanged ? 1 : 0);
  const filtering = activeCount > 0;
  const distanceLabel = wholeCity && city ? t("pawfamily.wholeCity", { city }) : t("pawfamily.km", { count: filters.radiusKm });
  const count = ids?.length ?? 0;
  const summary =
    wholeCity && city
      ? t("pawfamily.resultsCity", { count, city })
      : t("pawfamily.resultsNear", { count, distance: t("pawfamily.km", { count: filters.radiusKm }) });
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

      {/* Filtros: una barra compacta con lo activo y el resto en una hoja, como en las apps de búsqueda. */}
      <View className="mt-5 gap-2" testID="adoption-filters">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeCount ? t("pawfamily.filtersActive", { count: activeCount }) : t("pawfamily.filters")}
            onPress={() => setFiltersOpen(true)}
            className="min-h-[44px] flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 active:opacity-80"
            testID="open-filters"
          >
            <Icon name="options-outline" size={18} color={colors.ink} />
            <Text variant="captionStrong">{t("pawfamily.filters")}</Text>
            {activeCount ? (
              <View className="h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-strong px-1.5">
                <Text variant="label" tone="white">
                  {String(activeCount)}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            <FilterPill
              icon="location-outline"
              label={distanceLabel}
              onPress={() => setFiltersOpen(true)}
              testID="pill-distance"
            />
            {pills.map((pill) => (
              <FilterPill key={pill.key} label={pill.label} onRemove={pill.onRemove} testID={`pill-${pill.key}`} />
            ))}
          </ScrollView>
        </View>
        <Text variant="caption" tone="body" accessibilityLiveRegion="polite" testID="adoption-count">
          {ids === null ? t("pawfamily.loading") : summary}
        </Text>
      </View>

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t("pawfamily.filters")}
        subtitle={t("pawfamily.filtersHint")}
        testID="filters-sheet"
        footer={
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button
                variant="ghost"
                label={t("pawfamily.clearFilters")}
                disabled={!filtering}
                onPress={reset}
                testID="filters-clear"
              />
            </View>
            <View className="flex-[2]">
              <Button
                label={ids === null ? t("pawfamily.seeResults") : t("pawfamily.seeCount", { count: ids.length })}
                onPress={() => setFiltersOpen(false)}
                testID="filters-apply"
              />
            </View>
          </View>
        }
      >
        <FilterSection title={t("pawfamily.distance")}>
          <View className="flex-row flex-wrap gap-2">
            {ADOPTION_RADII.map((km) => (
              <OptionTile
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
          </View>
          {city ? (
            <ToggleRow
              icon="business-outline"
              title={t("pawfamily.wholeCity", { city })}
              description={t("pawfamily.wholeCityDesc")}
              value={wholeCity}
              onChange={setWholeCity}
              testID="whole-city"
            />
          ) : null}
        </FilterSection>
        <FilterSection title={t("pawfamily.animal")}>
          <Segmented
            value={filters.species}
            onChange={(v) => setFilter("species", v)}
            options={[
              { value: undefined, label: t("pawfamily.all"), testID: "filter-species-all" },
              ...(["dog", "cat", "other"] as const).map((v) => ({ value: v, label: t(`species.${v}`), testID: `filter-${v}` })),
            ]}
          />
        </FilterSection>
        <FilterSection title={t("pet.sex")}>
          <Segmented
            value={filters.sex}
            onChange={(v) => setFilter("sex", v)}
            options={[
              { value: undefined, label: t("pawfamily.all"), testID: "filter-sex-all" },
              { value: "female" as const, label: t("pawfamily.female"), icon: "female" as const, testID: "filter-female" },
              { value: "male" as const, label: t("pawfamily.male"), icon: "male" as const, testID: "filter-male" },
            ]}
          />
        </FilterSection>
        <FilterSection title={t("pet.size")}>
          <Segmented
            value={filters.size}
            onChange={(v) => setFilter("size", v)}
            options={[
              { value: undefined, label: t("pawfamily.all"), testID: "filter-size-all" },
              ...(["small", "medium", "large"] as const).map((v) => ({ value: v, label: t(`size.${v}`), testID: `filter-${v}` })),
            ]}
          />
        </FilterSection>
        <FilterSection title={t("pet.age")} last>
          <Segmented
            value={filters.age}
            onChange={(v) => setFilter("age", v)}
            options={[
              { value: undefined, label: t("pawfamily.all"), testID: "filter-age-all" },
              ...(["puppy", "young", "adult", "senior"] as const).map((v) => ({
                value: v,
                label: t(`ageShort.${v}`),
                testID: `filter-${v}`,
              })),
            ]}
          />
        </FilterSection>
      </Sheet>

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

/** Una categoría de la hoja de filtros, con su título y una línea que la separa de la siguiente. */
function FilterSection({ title, last, children }: { title: string; last?: boolean; children: ReactNode }) {
  return (
    <View className={last ? "gap-2.5 py-4" : "gap-2.5 border-b border-border/60 py-4"}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

type SegmentOption<V> = { value: V; label: string; icon?: IconName; testID: string };

/** Control segmentado: opciones del mismo ancho en una sola pieza; la elegida se resalta. */
function Segmented<V extends string | undefined>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
  const { colors } = useTheme();
  return (
    <View className="flex-row rounded-2xl bg-surface-alt p-1" accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.testID}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(option.value)}
            className={
              selected
                ? "min-h-[44px] flex-1 flex-row items-center justify-center gap-1 rounded-xl bg-surface px-1 shadow-sm shadow-black/10"
                : "min-h-[44px] flex-1 flex-row items-center justify-center gap-1 rounded-xl px-1 active:opacity-70"
            }
            testID={option.testID}
          >
            {option.icon ? <Icon name={option.icon} size={15} color={selected ? colors.primaryStrong : colors.muted} /> : null}
            <Text
              variant="captionStrong"
              tone={selected ? "primary" : "body"}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Opción de distancia: tres por fila, del mismo tamaño. */
function OptionTile({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      className={
        selected
          ? "min-h-[48px] grow basis-[30%] items-center justify-center rounded-2xl border-2 border-primary-strong bg-primary-soft"
          : "min-h-[48px] grow basis-[30%] items-center justify-center rounded-2xl border border-border bg-surface active:opacity-70"
      }
      testID={testID}
    >
      <Text variant="bodyStrong" tone={selected ? "primary" : "ink"}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Etiqueta de un filtro activo en la barra: se quita con la x o abre los filtros. */
function FilterPill({
  label,
  icon,
  onPress,
  onRemove,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  onRemove?: () => void;
  testID: string;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View className="min-h-[44px] flex-row items-center rounded-full bg-primary-soft pl-3.5 pr-1" testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={!onPress}
        className="min-h-[44px] flex-row items-center gap-1.5 pr-2.5 active:opacity-70"
      >
        {icon ? <Icon name={icon} size={15} color={colors.primaryStrong} /> : null}
        <Text variant="captionStrong" tone="primary">
          {label}
        </Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("pawfamily.removeFilter", { name: label })}
          onPress={onRemove}
          hitSlop={6}
          className="h-8 w-8 items-center justify-center rounded-full active:opacity-70"
          testID={`${testID}-remove`}
        >
          <Icon name="close" size={16} color={colors.primaryStrong} />
        </Pressable>
      ) : null}
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
