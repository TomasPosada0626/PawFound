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
  /** Interno: permite a la familia agradecer a quien ayudó ("Ángel de patas"). Nunca se muestra. */
  authorId: string;
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
  /** Personas a quienes la familia agradeció al cerrar el caso (insignia "Ángel de patas"). */
  helperIds?: string[];
  /** Retirado por moderación: deja de contar para insignias y estadísticas. */
  moderationRemoved?: boolean;
};

/**
 * Perfil preventivo de una mascota propia ("Mis mascotas"). Si se pierde, "Se perdió"
 * llena el reporte con estos datos y solo falta confirmar dónde y cuándo.
 */
export type OwnedPet = {
  id: string;
  ownerId: string;
  name: string;
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
  shyOrIndoor: boolean;
  createdAt: string;
  /** Último reporte publicado desde este perfil (para no duplicarlo si sigue activo). */
  lastCaseId?: string;
};

/**
 * Zona de alertas de una cuenta: punto aproximado (celda de 250 m, nunca el exacto). Recibe
 * la Alerta Ángel de un caso cuando el círculo de vida cubre este punto. Solo existe si la
 * persona dio su consentimiento.
 */
export type AlertZone = {
  location: LatLng;
  zone: string;
};

export type AvatarId = "dog" | "cat" | "fox" | "panda" | "bunny" | "bear";

export type ProfileTitle = "animal_lover" | "rescuer" | "neighbor" | "volunteer" | "foster";

export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  /** Opcional: nunca se verifica ni se muestra a otras personas. */
  phone?: string;
  /** Correo verificado con el código de 6 dígitos (o por Google/Apple): insignia azul. */
  verified: boolean;
  avatar: AvatarId;
  title: ProfileTitle;
  bio: string;
  city: string;
  neighborhood?: string;
  createdAt: string;
  ratingSum: number;
  ratingCount: number;
  /** Sanción temporal de moderación: no puede enviar mensajes hasta esta fecha. */
  mutedUntil?: string;
  /** Idioma preferido: el servidor traduce hacia este idioma los mensajes de chat. */
  lang: Lang;
};

export type MessageKind = "text" | "system" | "sighting";

/** Foto adjunta a un mensaje (grupos y DM). Se envía sin ubicación ni datos del celular. */
export type MessagePhoto = { uri: string; width: number; height: number };

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
  /** Foto adjunta; el texto puede ir vacío. */
  photo?: MessagePhoto;
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
  /** Chat cerrado: un mensaje directo que cerró una de las dos personas (los grupos no se cierran). */
  archived: boolean;
  closedBy?: string;
  /** Quienes lo archivaron en su propia lista (cada persona decide; nunca se borra solo). */
  archivedBy: string[];
};

export type NotificationKind =
  | "lost_nearby"
  | "found_nearby"
  | "case_update"
  | "sighting"
  | "comment"
  | "case_closed"
  | "possible_match"
  /** Alerta Ángel: una mascota se perdió dentro de tu zona de alertas. */
  | "angel_alert"
  /** El círculo de vida de una mascota perdida creció hasta tu zona. */
  | "life_circle"
  /** La familia te agradeció al cerrar el caso (insignia "Ángel de patas"). */
  | "thanked"
  /** Alguien encontró una mascota parecida a una de "Mis mascotas": "¿Es Rocky?". */
  | "owned_match";

export type AppNotification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  petId: string;
  /** En owned_match: la mascota propia que se parece al reporte encontrado. */
  ownedPetId?: string;
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
  /** Alertas Ángel: mascotas perdidas dentro de la zona de alertas. */
  angelAlerts: boolean;
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
  push: boolean;
  email: boolean;
  dailyDigest: boolean;
};

export type WhoCanMessage = "everyone" | "verified" | "nobody";

/** Ningún perfil es oculto: insignias, mascotas y antigüedad siempre son visibles (decisión de producto). */
export type PrivacyPrefs = {
  whoCanMessage: WhoCanMessage;
};

/** No se bloquea a nadie: se reporta y el equipo de moderación decide (docs/legal/moderacion-y-ugc.md). */
export type UserReportReason = "spam" | "rude" | "scam" | "inappropriate" | "other";

export type UserReport = {
  id: string;
  reporterId: string;
  reportedId: string;
  reason: UserReportReason;
  threadId?: string;
  messageId?: string;
  note?: string;
  at: string;
};
