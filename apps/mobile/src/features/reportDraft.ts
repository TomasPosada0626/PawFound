import { FOUND_RADIUS_OPTIONS } from "@/domain/lifeCircle";
import type { AgeRange, CaseKind, FoundCondition, FoundCustody, LatLng, OwnedPet, PetSize, Sex, Species } from "@/domain/types";
import { validateReport, type FieldErrors } from "@/domain/validation";
import type { NewReportInput } from "@/services/backendTypes";

/** Cuándo se vio por última vez: opciones rápidas en vez de un selector de fecha. */
export const WHEN_OFFSETS_MIN = { now: 0, m30: 30, h1: 60, h3: 180, h6: 360, h12: 720, h24: 1440, h48: 2880 } as const;
export type WhenKey = keyof typeof WHEN_OFFSETS_MIN;
export const WHEN_KEYS = Object.keys(WHEN_OFFSETS_MIN) as WhenKey[];

export type ReportDraft = {
  kind: CaseKind;
  photos: string[];
  name: string;
  species: Species | null;
  breed: string;
  sex: Sex | null;
  age: AgeRange | null;
  size: PetSize | null;
  color: string;
  collar: string;
  marks: string;
  description: string;
  traumaticEvent: boolean;
  shyOrIndoor: boolean;
  point: LatLng | null;
  zone: string;
  when: WhenKey;
  reward: boolean;
  foundRadius: number;
  condition: FoundCondition | null;
  custody: FoundCustody | null;
};

export function emptyDraft(kind: CaseKind = "lost"): ReportDraft {
  return {
    kind,
    photos: [],
    name: "",
    species: null,
    breed: "",
    sex: null,
    age: null,
    size: null,
    color: "",
    collar: "",
    marks: "",
    description: "",
    traumaticEvent: false,
    shyOrIndoor: false,
    point: null,
    zone: "",
    when: "now",
    reward: false,
    foundRadius: FOUND_RADIUS_OPTIONS[0],
    condition: null,
    custody: null,
  };
}

/** "Se perdió" desde Mis mascotas: todo listo menos dónde y cuándo. */
export function draftFromOwnedPet(pet: OwnedPet): ReportDraft {
  return {
    ...emptyDraft("lost"),
    photos: pet.photos,
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? "",
    sex: pet.sex,
    age: pet.age,
    size: pet.size,
    color: pet.color ?? "",
    collar: pet.collar ?? "",
    marks: pet.marks ?? "",
    description: pet.description,
    shyOrIndoor: pet.shyOrIndoor,
  };
}

/** Un borrador vale la pena restaurarlo si la persona alcanzó a escribir o elegir algo. */
export function isDraftMeaningful(draft: ReportDraft): boolean {
  return Boolean(draft.photos.length || draft.name.trim() || draft.description.trim() || draft.species || draft.point);
}

export type DraftErrors = FieldErrors<"name" | "species" | "description" | "photos" | "hasLocation">;

export function validateDraft(draft: ReportDraft): DraftErrors {
  return validateReport({
    kind: draft.kind,
    name: draft.name,
    species: draft.species,
    description: draft.description,
    photos: draft.photos,
    hasLocation: draft.point !== null,
  });
}

/** Convierte el borrador en la petición al backend (que aproxima la ubicación). */
export function toReportInput(draft: ReportDraft, now: Date, fallbackZone: string): NewReportInput {
  if (!draft.species || !draft.point) throw new Error("Borrador incompleto: valida antes de convertir");
  return {
    kind: draft.kind,
    name: draft.name,
    species: draft.species,
    breed: draft.breed,
    sex: draft.sex ?? "unknown",
    age: draft.age ?? "unknown",
    size: draft.size ?? "medium",
    color: draft.color,
    collar: draft.collar,
    marks: draft.marks,
    description: draft.description,
    photos: draft.photos,
    traumaticEvent: draft.traumaticEvent,
    shyOrIndoor: draft.shyOrIndoor,
    lastSeenAt: new Date(now.getTime() - WHEN_OFFSETS_MIN[draft.when] * 60_000).toISOString(),
    location: draft.point,
    zone: draft.zone.trim() || fallbackZone,
    foundSearchRadius: draft.kind === "found" ? draft.foundRadius : undefined,
    reward: draft.reward,
    foundCondition: draft.condition ?? undefined,
    foundCustody: draft.custody ?? undefined,
  };
}
