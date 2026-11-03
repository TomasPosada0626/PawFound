import type { AgeRange, LatLng, PetSize, Sex, Species } from "./types";

/**
 * PawFamily: adopción responsable y 100 % gratuita dentro de PawFound (mismas reglas que
 * apps/api/internal/app/adoptions.go).
 */
export type AdoptionStatus = "available" | "in_process" | "adopted" | "withdrawn";
/** "expired": pasaron 14 días sin respuesta de quien publicó. */
export type ApplicationStatus = "pending" | "accepted" | "declined" | "expired";

/** Novedad de la nueva familia después de adoptar: una foto y unas palabras. */
export type AdoptionUpdate = {
  id: string;
  adoptionId: string;
  authorId: string;
  photo?: string;
  body: string;
  at: string;
};

/** Perfil público de un refugio verificado: lo que tiene en adopción y sus adopciones logradas. */
export type ShelterSummary = { name: string; available: number; adopted: number };

/** Texto de una novedad (como la API). */
export const ADOPTION_UPDATE_MAX = 300;

export type Adoption = {
  id: string;
  ownerId: string;
  name: string;
  species: Species;
  breed?: string;
  sex: Sex;
  age: AgeRange;
  size: PetSize;
  color?: string;
  description: string;
  vaccinated: boolean;
  sterilized: boolean;
  photos: string[];
  location: LatLng;
  zone: string;
  status: AdoptionStatus;
  createdAt: string;
  adoptedAt?: string;
  /** Solo para quien publicó y para la persona aceptada para adoptar. */
  address?: string;
  /** Solicitudes por responder (solo para quien publicó). */
  pending?: number;
  /** Estado de la solicitud de quien mira, si se postuló. */
  myApplication?: ApplicationStatus;
};

export type AdoptionApplication = {
  id: string;
  adoptionId: string;
  applicantId: string;
  fullName: string;
  household: number;
  neighborhood: string;
  city: string;
  hadPets: boolean;
  petsCount: number;
  reason: string;
  status: ApplicationStatus;
  threadId?: string;
  createdAt: string;
};

export type AdoptionInput = {
  name: string;
  species: Species;
  breed?: string;
  sex: Sex;
  age: AgeRange;
  size: PetSize;
  color?: string;
  description: string;
  vaccinated: boolean;
  sterilized: boolean;
  /** URIs locales o ya subidas. */
  photos: string[];
  location: LatLng;
  zone: string;
  address?: string;
};

export type ApplicationInput = Pick<
  AdoptionApplication,
  "fullName" | "household" | "neighborhood" | "city" | "hadPets" | "petsCount" | "reason"
>;

/** Filtros de la lista. No hay filtro de raza: muchas mascotas son criollas. */
export type AdoptionFilters = {
  radiusKm: number;
  /** Con ciudad se busca en toda la ciudad y se ignora la distancia. */
  city?: string;
  species?: Species;
  sex?: Exclude<Sex, "unknown">;
  size?: PetSize;
  age?: Exclude<AgeRange, "unknown">;
};

export type AdoptionReportReason = "money" | "scam" | "inappropriate" | "other";

/** Distancias que se pueden elegir, en km. */
export const ADOPTION_RADII = [2, 5, 10, 25, 50, 100] as const;
export const DEFAULT_ADOPTION_FILTERS: AdoptionFilters = { radiusKm: 10 };

/** El informe para adoptar: mismos límites que la API. */
export const APPLICATION_REASON_MIN = 20;
export const APPLICATION_REASON_MAX = 600;

export function applicationProblem(input: ApplicationInput): keyof ApplicationInput | null {
  const reason = input.reason.trim().length;
  if (!input.fullName.trim()) return "fullName";
  if (!Number.isInteger(input.household) || input.household < 1 || input.household > 20) return "household";
  if (!input.neighborhood.trim()) return "neighborhood";
  if (!input.city.trim()) return "city";
  if (input.petsCount < 0 || input.petsCount > 50 || (!input.hadPets && input.petsCount !== 0)) return "petsCount";
  if (reason < APPLICATION_REASON_MIN || reason > APPLICATION_REASON_MAX) return "reason";
  return null;
}

/** Visible en la lista: disponible o en proceso de adopción. */
export function isListed(adoption: Adoption): boolean {
  return adoption.status === "available" || adoption.status === "in_process";
}
