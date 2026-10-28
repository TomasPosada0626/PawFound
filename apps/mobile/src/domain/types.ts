/**
 * Modelo de dominio de la app. Refleja la forma prevista del contrato OpenAPI
 * (packages/contracts/openapi.yaml); cuando exista el cliente generado, estos tipos
 * se reemplazan por los generados.
 */

export type LatLng = { latitude: number; longitude: number };

/** Idiomas soportados por la app y por la traducción de chats. */
export type Lang = "es" | "en";

export type Species = "dog" | "cat" | "other";
export type Sex = "male" | "female" | "unknown";
export type PetSize = "small" | "medium" | "large";
export type AgeRange = "puppy" | "young" | "adult" | "senior" | "unknown";

/** Tipo de reporte: la mascota se perdió, o alguien la encontró. */
export type CaseKind = "lost" | "found";
/**
 * Un caso queda archivado (no borrado) al marcar el reencuentro. `archived` cubre el
 * resto de cierres (p. ej. la cuenta autora se eliminó).
 */
export type CaseState = "active" | "reunited" | "archived";

export type FoundCondition = "good" | "scared" | "injured" | "needs_vet";
export type FoundCustody = "with_me" | "vet" | "shelter" | "left_there";

export type Sighting = {
  id: string;
  at: string;
  /** Siempre aproximada (ver geo.approximateLocation). */
  location: LatLng;
  zone: string;
  note?: string;
  authorShortName: string;
};

export type PetCase = {
  id: string;
  kind: CaseKind;
  state: CaseState;
  /** Opcional en mascotas encontradas: quien la encontró puede no saberlo. */
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
  /** Hubo fuegos artificiales, accidente, tormenta o ruido fuerte (issue #10). */
  traumaticEvent: boolean;
  /** Mascota tímida o de interior: se esconde cerca (issue #10). */
  shyOrIndoor: boolean;
  /** Último avistamiento (reporte inicial o avistamiento posterior). */
  lastSeenAt: string;
  /** Ubicación aproximada del último avistamiento — nunca la exacta (issue #46). */
  location: LatLng;
  zone: string;
  /** Radio fijo elegido para mascotas encontradas (las perdidas usan el círculo de vida). */
  foundSearchRadius?: number;
  reward: boolean;
  foundCondition?: FoundCondition;
  foundCustody?: FoundCustody;
  ownerId: string;
  ownerShortName: string;
  createdAt: string;
  reunitedAt?: string;
  sightings: Sighting[];
  shareCount: number;
  groupId: string;
};

export type AvatarId = "dog" | "cat" | "fox" | "panda" | "bunny" | "bear";

export type ProfileTitle = "animal_lover" | "rescuer" | "neighbor" | "volunteer" | "foster";

export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  phoneVerified: boolean;
  avatar: AvatarId;
  title: ProfileTitle;
  bio: string;
  city: string;
  neighborhood?: string;
  createdAt: string;
  ratingSum: number;
  ratingCount: number;
  /** Idioma preferido: el servidor traduce hacia este idioma los mensajes de chat. */
  lang: Lang;
};

export type MessageKind = "text" | "system" | "sighting";

export type Message = {
  id: string;
  threadId: string;
  authorId: string;
  authorShortName: string;
  text: string;
  at: string;
  kind: MessageKind;
  /** Idioma en que se escribió (el de la app de quien lo envió). */
  lang?: Lang;
  /** Traducciones generadas por el servidor (proveedor sujeto a evaluación de privacidad). */
  translations?: Partial<Record<Lang, string>>;
};

export type Thread = {
  id: string;
  kind: "dm" | "group";
  /** Grupo de caso: siempre ligado a una mascota. DM: la mascota que motivó el contacto. */
  petId?: string;
  memberIds: string[];
  /** Último mensaje leído por usuario (id de usuario → ISO). */
  readAt: Record<string, string>;
  mutedBy: string[];
  archived: boolean;
};

export type NotificationKind =
  "lost_nearby" | "found_nearby" | "case_update" | "sighting" | "comment" | "case_closed" | "possible_match";

export type AppNotification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  petId: string;
  at: string;
  read: boolean;
};

export type NotificationPrefs = {
  lostNearby: boolean;
  foundNearby: boolean;
  comments: boolean;
  directMessages: boolean;
  groups: boolean;
  lifeCircle: boolean;
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
  push: boolean;
  email: boolean;
  dailyDigest: boolean;
};

export type WhoCanMessage = "everyone" | "verified" | "nobody";

export type PrivacyPrefs = {
  whoCanMessage: WhoCanMessage;
  blockedUserIds: string[];
};
