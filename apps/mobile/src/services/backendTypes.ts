import type { BadgeProgress } from "@/domain/badges";
import type {
  AgeRange,
  AlertZone,
  AppNotification,
  CaseKind,
  FoundCondition,
  FoundCustody,
  LatLng,
  Message,
  NotificationPrefs,
  OwnedPet,
  PetCase,
  Place,
  StoryItem,
  PetSize,
  PrivacyPrefs,
  Sex,
  UserReport,
  Species,
  Thread,
  User,
} from "@/domain/types";

export type ErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "phone_taken"
  | "invalid_phone"
  | "wrong_code"
  | "locked"
  | "expired"
  | "rate_limited"
  | "not_allowed"
  | "not_found"
  | "cannot_message"
  | "invalid_username"
  | "username_taken"
  | "muted"
  | "story_full"
  | "provider_unavailable"
  | "invalid_input"
  | "suspended"
  | "unauthorized"
  | "network"
  | "unknown";

/** Error de negocio con código traducible (nunca un texto armado en el backend). */
export class BackendError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "BackendError";
  }
}

export type Verification = {
  userId: string;
  email: string;
  code: string;
  sentAt: string;
  attempts: number;
  lockedUntil?: string;
};

export type BackendState = {
  users: Record<string, User>;
  sessionUserId: string | null;
  pets: PetCase[];
  threads: Thread[];
  messages: Message[];
  notifications: AppNotification[];
  /** Fechas de publicación por cuenta, para el límite diario. */
  reportLog: Record<string, string[]>;
  notificationPrefs: Record<string, NotificationPrefs>;
  privacyPrefs: Record<string, PrivacyPrefs>;
  verification: Verification | null;
  /** Zonas de Alerta Ángel por cuenta (solo con consentimiento; punto aproximado). */
  alertZones: Record<string, AlertZone>;
  /** Casos que cada cuenta compartió (sin repetir), para la insignia "Difusor". */
  shareLog: Record<string, string[]>;
  /** Perfiles preventivos de mascotas propias. */
  ownedPets: OwnedPet[];
  /** Reportes de personas (spam, groserías, estafas) para el equipo de moderación. */
  userReports: UserReport[];
  /** "Me gusta" de perfil: cuenta → quienes le dieron me gusta (uno por persona). */
  profileLikes: Record<string, string[]>;
  /** Actualizaciones de las historias de casos (no vencen; se quitan al cerrar el caso). */
  stories: StoryItem[];
  /**
   * Veterinarias y refugios cercanos. En demostración está vacío: no se inventan lugares; con
   * el servidor se cargan de OpenStreetMap (api import-places).
   */
  places: Place[];
  /** Insignias de otras cuentas calculadas por la API (en demostración se calculan aquí). */
  remoteBadges: Record<string, BadgeProgress[]>;
};

export type OwnedPetInput = Omit<OwnedPet, "id" | "ownerId" | "createdAt" | "lastCaseId">;

export type NewReportInput = {
  kind: CaseKind;
  name?: string;
  species: Species;
  breed?: string;
  sex: Sex;
  age: AgeRange;
  size: PetSize;
  color?: string;
  collar?: string;
  marks?: string;
  description: string;
  photos: string[];
  traumaticEvent: boolean;
  shyOrIndoor: boolean;
  lastSeenAt: string;
  /** Punto exacto elegido en el mapa: el backend lo aproxima antes de guardarlo. */
  location: LatLng;
  zone: string;
  foundSearchRadius?: number;
  reward: boolean;
  foundCondition?: FoundCondition;
  foundCustody?: FoundCustody;
  /** Si se publicó desde "Mis mascotas", el perfil queda enlazado al caso. */
  ownedPetId?: string;
};

export type NewSightingInput = {
  at: string;
  location: LatLng;
  zone: string;
  note?: string;
};

export type SocialProvider = "google" | "apple";

export type ProfilePatch = Partial<
  Pick<User, "name" | "username" | "avatar" | "title" | "bio" | "city" | "neighborhood" | "phone">
>;
