// Tipos de la API, utilidades y estado inicial que comparten las partes del cliente de la API.

import type { BadgeProgress } from "@/domain/badges";
import type { Adoption, AdoptionApplication, ShelterSummary } from "@/domain/adoption";

import type {
  AlertZone,
  Lang,
  Message,
  NotificationPrefs,
  OwnedPet,
  PetCase,
  PrivacyPrefs,
  StoryItem,
  Thread,
  User,
} from "@/domain/types";

import { type FollowStatus, type BackendState, type ErrorCode } from "../backendTypes";

export type NativeFiles = typeof import("expo-file-system/legacy");

/** Subida nativa de archivos (expo-file-system); null donde no existe (web, pruebas). */
export function nativeFiles(): NativeFiles | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-file-system/legacy") as NativeFiles;
  } catch {
    return null;
  }
}

/** Resultado de renovar: "failed" es un problema de red o del servidor, no cierra la sesión. */
export type RenewResult = "ok" | "rejected" | "failed";
export const NEARBY_RADIUS = 20_000;
/** Tope de resultados de la API: con la lista llena no se sabe qué quedó por fuera. */
export const NEARBY_LIMIT = 200;
export const RESEND_COOLDOWN_S = 45;

export type Tokens = { access: string; refresh: string };
export type Listener = () => void;

export type ApiUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  verified: boolean;
  avatar: User["avatar"];
  photoUrl?: string;
  title: User["title"];
  bio: string;
  city: string;
  neighborhood?: string;
  createdAt: string;
  mutedUntil?: string;
  lang: Lang;
  founder?: boolean;
  shelterName?: string;
  shelterStatus?: User["shelterStatus"];
  /** Perfil público: nombre del refugio solo si está verificado. */
  shelter?: string;
};
export type ApiSummary = {
  id: string;
  shortName: string;
  avatar: User["avatar"];
  photoUrl?: string;
  verified: boolean;
  createdAt: string;
  lang: Lang;
  shelter?: string;
};
export type ApiMe = {
  user: ApiUser;
  notificationPrefs: NotificationPrefs;
  privacyPrefs: PrivacyPrefs;
  alertZone: AlertZone | null;
  allowance: { allowed: boolean; retryAt?: string };
  activeSessions?: number;
};
export type ApiSession = { accessToken: string; refreshToken: string; me: ApiMe; needsVerification: boolean };
export type ApiPet = Omit<PetCase, "sightings"> & {
  sightings: (Omit<PetCase["sightings"][number], "authorId"> & { authorId?: string })[];
  owner?: ApiSummary;
};
export type ApiMessage = Omit<Message, "photo"> & { photo?: { url: string; width: number; height: number } };
export type ApiThread = Omit<Thread, "readAt"> & {
  readAt: Record<string, string>;
  members: ApiSummary[];
  lastMessage?: ApiMessage;
};
export type ApiStory = { pet: ApiPet; items: (Omit<StoryItem, "photo"> & { photo?: string })[] };
export type ApiPerson = ApiSummary & { username: string };
export type ApiAdoption = Omit<Adoption, "ownerId"> & { owner: ApiSummary };
export type ApiApplication = Omit<AdoptionApplication, "applicantId"> & { applicant: ApiSummary; adoption?: ApiAdoption };
export type ApiNetwork = { requests: ApiPerson[]; followers: ApiPerson[]; following: ApiPerson[]; sent: ApiPerson[] };
export type ApiProfile = {
  user: Omit<ApiUser, "email">;
  likes: number;
  likedByMe: boolean;
  rating: number;
  ratingCount: number;
  followers: number;
  following: number;
  followStatus: FollowStatus;
  badges: BadgeProgress[];
  shelter?: ShelterSummary;
  pets: (Pick<
    OwnedPet,
    "id" | "name" | "species" | "breed" | "sex" | "age" | "size" | "color" | "collar" | "description" | "shyOrIndoor"
  > & {
    photo?: string;
    photos?: string[];
  })[];
};

export function emptyState(): BackendState {
  return {
    users: {},
    sessionUserId: null,
    pets: [],
    threads: [],
    messages: [],
    notifications: [],
    reportLog: {},
    notificationPrefs: {},
    privacyPrefs: {},
    verification: null,
    alertZones: {},
    shareLog: {},
    ownedPets: [],
    userReports: [],
    profileLikes: {},
    stories: [],
    places: [],
    remoteBadges: {},
    network: { requests: [], followers: [], following: [], sent: [] },
    shelterSummaries: {},
    followInfo: {},
    remoteRatings: {},
    follows: [],
    ratingStars: {},
    adoptions: [],
    adoptionApplications: [],
    adoptionVersion: 0,
    onlineCount: null,
    nearbyLoaded: false,
    threadsLoaded: false,
    activeSessions: 0,
  };
}

export const KNOWN_CODES = new Set<ErrorCode>([
  "follow_wait",
  "adoption_terms",
  "already_applied",
  "nit_taken",
  "nit_inactive",
  "nit_not_found",
  "nit_not_nonprofit",
  "nit_dv_mismatch",
  "shelter_name_mismatch",
  "invalid_credentials",
  "email_taken",
  "phone_taken",
  "invalid_phone",
  "wrong_code",
  "locked",
  "expired",
  "rate_limited",
  "not_allowed",
  "not_found",
  "cannot_message",
  "invalid_username",
  "username_taken",
  "muted",
  "story_full",
  "provider_unavailable",
  "invalid_input",
  "suspended",
  "unauthorized",
  "storage_unavailable",
  "invalid_image",
]);
