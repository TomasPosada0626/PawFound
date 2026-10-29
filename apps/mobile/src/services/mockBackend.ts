import { alertAudience, type AlertCandidate } from "@/domain/alerts";
import { approximateLocation } from "@/domain/geo";
import { matchOwned } from "@/domain/matching";
import { findPossibleMatches, publishAllowance } from "@/domain/rules";
import type {
  AlertZone,
  LatLng,
  AppNotification,
  Lang,
  LocationShare,
  Message,
  MessageKind,
  MessageLocation,
  MessagePhoto,
  NotificationKind,
  NotificationPrefs,
  OwnedPet,
  PetCase,
  PrivacyPrefs,
  StoryItem,
  Thread,
  User,
  UserReport,
  UserReportReason,
} from "@/domain/types";
import { shortName } from "@/domain/privacy";
import { normalizeColombianMobile, normalizeUsername } from "@/domain/validation";

import { reunionHelperCandidates } from "./selectors";

import {
  BackendError,
  type BackendState,
  type NewReportInput,
  type NewSightingInput,
  type OwnedPetInput,
  type ProfilePatch,
  type SocialProvider,
} from "./backendTypes";

/**
 * Backend simulado en memoria para el modo demostración.
 *
 * Aplica las mismas reglas de negocio que la API (límite diario, verificación SMS,
 * ubicación aproximada, permisos), para que la app se comporte igual cuando se conecte
 * al servidor real. Es un "external store": la UI se suscribe con useSyncExternalStore.
 *
 * Las contraseñas de demostración viven en texto plano solo aquí, en memoria y en el
 * dispositivo; la API real usa Argon2id (docs/ARCHITECTURE.md).
 */

/** Código de verificación en modo demostración (la API real lo envía al correo). */
export const DEMO_CODE = "123456";
export const RESEND_COOLDOWN_S = 45;
export const CODE_TTL_MIN = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const LOCK_MINUTES = 5;
export const MESSAGE_MAX = 1000;
/** Nombre de un punto de encuentro ("Parque de Laureles"). */
export const LOCATION_LABEL_MAX = 60;
/** Máximo de personas que la familia puede agradecer al cerrar un caso. */
export const MAX_HELPERS = 5;
export const MAX_OWNED_PETS = 10;
/** Antispam: mensajes por minuto por cuenta. */
export const MESSAGES_PER_MINUTE = 12;
const ALERT_KINDS = new Set<NotificationKind>(["angel_alert", "life_circle"]);

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  lostNearby: true,
  foundNearby: true,
  comments: true,
  directMessages: true,
  groups: true,
  lifeCircle: true,
  angelAlerts: true,
  quietHours: false,
  quietFrom: "22:00",
  quietTo: "07:00",
  push: true,
  email: true,
  dailyDigest: false,
};

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = { whoCanMessage: "everyone" };

type Listener = () => void;

/**
 * Traductor de mensajes. En producción lo implementa la API con un proveedor evaluado
 * (docs/legal/incidentes-y-proveedores.md); en demo no hay traductor y los mensajes
 * nuevos se muestran en su idioma original, sin inventar traducciones.
 */
export type Translator = (text: string, from: Lang, to: Lang) => string | null;

export type BackendOptions = {
  now?: () => Date;
  translator?: Translator;
  /** Contraseñas de demostración por correo (en minúsculas). */
  credentials?: Record<string, string>;
};

export class MockBackend {
  private state: BackendState;
  private listeners = new Set<Listener>();
  private credentials: Map<string, { userId: string; password: string }>;
  private readonly now: () => Date;
  private readonly translator?: Translator;
  private seq = 0;

  constructor(initial: BackendState, options: BackendOptions = {}) {
    this.state = initial;
    this.now = options.now ?? (() => new Date());
    this.translator = options.translator;
    this.credentials = new Map();
    for (const [email, password] of Object.entries(options.credentials ?? {})) {
      const user = Object.values(initial.users).find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (user) this.credentials.set(email.toLowerCase(), { userId: user.id, password });
    }
  }

  // --- External store -------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BackendState => this.state;

  private commit(patch: Partial<BackendState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.now().getTime().toString(36)}${this.seq}`;
  }

  private iso() {
    return this.now().toISOString();
  }

  // --- Sesión y cuentas -----------------------------------------------------

  get currentUser(): User | null {
    const id = this.state.sessionUserId;
    return id ? (this.state.users[id] ?? null) : null;
  }

  private requireUser(): User {
    const user = this.currentUser;
    if (!user) throw new BackendError("not_allowed");
    return user;
  }

  /** Acciones de escritura comunitaria exigen teléfono verificado (insignia azul). */
  private requireVerified(): User {
    const user = this.requireUser();
    if (!user.verified) throw new BackendError("not_allowed");
    return user;
  }

  /** Entra con el correo o con el nombre de usuario. */
  async login(identifier: string, password: string): Promise<{ needsVerification: boolean }> {
    const id = identifier.trim().toLowerCase();
    const username = id.includes("@") && !id.startsWith("@") ? null : normalizeUsername(id);
    const email = username
      ? Object.values(this.state.users)
          .find((u) => u.username === username)
          ?.email.toLowerCase()
      : id;
    const entry = email ? this.credentials.get(email) : undefined;
    // Mismo error para correo inexistente y contraseña incorrecta: no revela si la cuenta existe.
    if (!entry || entry.password !== password) throw new BackendError("invalid_credentials");
    const user = this.state.users[entry.userId];
    if (!user) throw new BackendError("invalid_credentials");
    this.commit({ sessionUserId: user.id });
    if (!user.verified) {
      this.issueCode(user.id, user.email);
      return { needsVerification: true };
    }
    return { needsVerification: false };
  }

  /** Google o Apple ya confirmaron el correo: la cuenta queda verificada sin código. */
  async loginWithProvider(provider: SocialProvider): Promise<void> {
    const email = `demo.${provider}@pawfound.app`;
    let user = Object.values(this.state.users).find((u) => u.email === email);
    if (!user) {
      user = { ...this.makeUser({ name: `Persona ${provider[0]?.toUpperCase()}${provider.slice(1)}`, email }), verified: true };
      this.commit({ users: { ...this.state.users, [user.id]: user } });
    }
    this.commit({ sessionUserId: user.id });
  }

  /** Registro con correo, nombre y apellidos, usuario y contraseña. Envía el código al correo. */
  async register(input: { name: string; email: string; username: string; password: string }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    if (this.credentials.has(email)) throw new BackendError("email_taken");
    const username = normalizeUsername(input.username);
    if (!username) throw new BackendError("invalid_username");
    if (Object.values(this.state.users).some((u) => u.username === username)) throw new BackendError("username_taken");
    const user = this.makeUser({ name: input.name.trim(), email, username });
    this.credentials.set(email, { userId: user.id, password: input.password });
    this.commit({ users: { ...this.state.users, [user.id]: user }, sessionUserId: user.id });
    this.issueCode(user.id, email);
  }

  private makeUser({ name, email, username: chosen }: { name: string; email: string; username?: string }): User {
    const base =
      email
        .split("@")[0]
        ?.replace(/[^a-z0-9_]/gi, "")
        .toLowerCase() || "pawfriend";
    let username = chosen ?? base.slice(0, 16);
    while (!chosen && Object.values(this.state.users).some((u) => u.username === username)) {
      username = `${base.slice(0, 14)}${Math.floor(Math.random() * 90 + 10)}`;
    }
    return {
      id: this.id("u"),
      name,
      username,
      email,
      verified: false,
      avatar: "dog",
      title: "animal_lover",
      bio: "",
      city: "Medellín",
      createdAt: this.iso(),
      ratingSum: 0,
      ratingCount: 0,
      lang: "es",
    };
  }

  /** En demostración el código siempre es DEMO_CODE; la API real lo envía al correo. */
  private issueCode(userId: string, email: string) {
    this.commit({
      verification: { userId, email, code: DEMO_CODE, sentAt: this.iso(), attempts: 0 },
    });
  }

  /** Envía un código al correo de la cuenta actual (si todavía no está verificada). */
  async sendVerificationCode(): Promise<void> {
    const user = this.requireUser();
    if (!user.verified) this.issueCode(user.id, user.email);
  }

  secondsUntilResend(): number {
    const v = this.state.verification;
    if (!v) return 0;
    const elapsed = (this.now().getTime() - new Date(v.sentAt).getTime()) / 1000;
    return Math.max(0, RESEND_COOLDOWN_S - elapsed);
  }

  async resendCode(): Promise<void> {
    const v = this.state.verification;
    if (!v) throw new BackendError("not_allowed");
    if (this.secondsUntilResend() > 0) throw new BackendError("not_allowed");
    // Se conserva el contador de intentos: reenviar no reinicia el bloqueo.
    this.commit({ verification: { ...v, sentAt: this.iso(), code: DEMO_CODE } });
  }

  async verifyCode(code: string): Promise<void> {
    const v = this.state.verification;
    if (!v) throw new BackendError("not_allowed");
    const now = this.now();
    if (v.lockedUntil && new Date(v.lockedUntil) > now) {
      const minutes = Math.ceil((new Date(v.lockedUntil).getTime() - now.getTime()) / 60_000);
      throw new BackendError("locked", { minutes });
    }
    if (now.getTime() - new Date(v.sentAt).getTime() > CODE_TTL_MIN * 60_000) throw new BackendError("expired");
    if (code !== v.code) {
      const attempts = v.attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
        this.commit({ verification: { ...v, attempts: 0, lockedUntil } });
        throw new BackendError("locked", { minutes: LOCK_MINUTES });
      }
      this.commit({ verification: { ...v, attempts } });
      throw new BackendError("wrong_code", { count: MAX_CODE_ATTEMPTS - attempts });
    }
    const user = this.state.users[v.userId];
    if (!user) throw new BackendError("not_found");
    // Al verificar el correo se otorga la insignia azul ("Protector verificado").
    this.commit({
      users: { ...this.state.users, [user.id]: { ...user, verified: true } },
      verification: null,
    });
  }

  async logout(): Promise<void> {
    this.commit({ sessionUserId: null, verification: null });
  }

  async requestPasswordReset(_email: string): Promise<void> {
    // Respuesta idéntica exista o no la cuenta (sin enumeración de correos).
  }

  /** "Recordar sesión": restaura solo si la cuenta sigue existiendo. */
  restoreSession(userId: string): boolean {
    if (!this.state.users[userId]) return false;
    this.commit({ sessionUserId: userId });
    return true;
  }

  // --- Reportes ------------------------------------------------------------

  publishAllowanceFor(userId: string) {
    return publishAllowance(this.state.reportLog[userId] ?? [], this.now());
  }

  async createReport(input: NewReportInput): Promise<PetCase> {
    const user = this.requireVerified();
    const allowance = this.publishAllowanceFor(user.id);
    if (!allowance.allowed) throw new BackendError("rate_limited", { retryAt: allowance.retryAt.toISOString() });

    const petId = this.id("pet");
    const groupId = this.id("grp");
    const now = this.iso();
    const pet: PetCase = {
      id: petId,
      kind: input.kind,
      state: "active",
      name: input.name?.trim() || undefined,
      species: input.species,
      breed: input.breed?.trim() || undefined,
      sex: input.sex,
      age: input.age,
      size: input.size,
      color: input.color?.trim() || undefined,
      collar: input.collar?.trim() || undefined,
      marks: input.marks?.trim() || undefined,
      description: input.description.trim(),
      photos: input.photos.slice(0, 5),
      traumaticEvent: input.kind === "lost" && input.traumaticEvent,
      shyOrIndoor: input.shyOrIndoor,
      lastSeenAt: input.lastSeenAt,
      location: approximateLocation(input.location),
      zone: input.zone,
      foundSearchRadius: input.kind === "found" ? input.foundSearchRadius : undefined,
      reward: input.kind === "lost" && input.reward,
      foundCondition: input.kind === "found" ? input.foundCondition : undefined,
      foundCustody: input.kind === "found" ? input.foundCustody : undefined,
      ownerId: user.id,
      ownerShortName: shortName(user.name),
      createdAt: now,
      sightings: [],
      shareCount: 0,
      groupId,
    };
    const thread: Thread = {
      id: groupId,
      kind: "group",
      petId,
      memberIds: [user.id],
      readAt: { [user.id]: now },
      mutedBy: [],
      archived: false,
      archivedBy: [],
    };
    const matches = findPossibleMatches(pet, this.state.pets, this.now());
    const matchNotifications = matches.map((m) => this.makeNotification(m.pet.ownerId, "possible_match", petId));
    // Alerta Ángel: push a los celulares dentro del círculo de vida inicial (issue #45).
    const angelNotifications = alertAudience(pet, this.alertCandidates(pet), this.now()).map((id) =>
      this.makeNotification(id, "angel_alert", petId),
    );
    // "¿Es tu mascota?": una encontrada parecida a una de "Mis mascotas" avisa a su familia.
    const ownedNotifications = pet.kind === "found" ? this.ownedMatchNotifications(pet) : [];
    this.commit({
      pets: [pet, ...this.state.pets],
      threads: [thread, ...this.state.threads],
      messages: [...this.state.messages, this.makeMessage(groupId, "system", user, "created")],
      notifications: [...angelNotifications, ...ownedNotifications, ...matchNotifications, ...this.state.notifications],
      ownedPets: this.state.ownedPets.map((p) =>
        p.id === input.ownedPetId && p.ownerId === user.id ? { ...p, lastCaseId: petId } : p,
      ),
      reportLog: { ...this.state.reportLog, [user.id]: [...(this.state.reportLog[user.id] ?? []), now] },
    });
    return pet;
  }

  /**
   * Familias cuya mascota propia se parece a este reporte encontrado (domain/matching). Solo
   * con zona de alertas (la única ubicación que tenemos, con consentimiento) y con "encontradas
   * cerca" activado; si la mascota ya tiene un reporte de pérdida activo, ese caso recibe la
   * coincidencia normal y no se avisa dos veces.
   */
  private ownedMatchNotifications(found: PetCase): AppNotification[] {
    return this.state.ownedPets
      .filter((owned) => owned.ownerId !== found.ownerId && this.notificationPrefsFor(owned.ownerId).foundNearby)
      .filter((owned) => {
        const lastCase = owned.lastCaseId ? this.getPet(owned.lastCaseId) : undefined;
        return !(lastCase?.kind === "lost" && lastCase.state === "active");
      })
      .filter((owned) => {
        const zone = this.state.alertZones[owned.ownerId];
        return zone ? matchOwned(found, { ...owned, zone: zone.location }) !== null : false;
      })
      .map((owned) => ({ ...this.makeNotification(owned.ownerId, "owned_match", found.id), ownedPetId: owned.id }));
  }

  getPet(petId: string): PetCase | undefined {
    return this.state.pets.find((p) => p.id === petId);
  }

  private requirePet(petId: string): PetCase {
    const pet = this.getPet(petId);
    if (!pet) throw new BackendError("not_found");
    return pet;
  }

  private replacePet(pet: PetCase) {
    return this.state.pets.map((p) => (p.id === pet.id ? pet : p));
  }

  /** Cuentas con zona de alertas, con lo necesario para decidir si se les avisa de este caso. */
  private alertCandidates(pet: PetCase): AlertCandidate[] {
    const dayAgo = new Date(this.now().getTime() - 24 * 3_600_000).toISOString();
    return Object.entries(this.state.alertZones).map(([userId, zone]) => {
      const received = this.state.notifications.filter((n) => n.userId === userId && ALERT_KINDS.has(n.kind));
      return {
        userId,
        zone,
        prefs: this.notificationPrefsFor(userId),
        alertsLast24h: received.filter((n) => n.at > dayAgo).length,
        alreadyAlerted: received.some((n) => n.petId === pet.id),
      };
    });
  }

  /**
   * Tareas periódicas del servidor (en la API, un job cada pocos minutos). Hoy: a medida que
   * el círculo de vida crece, la Alerta Ángel llega a los celulares que van quedando dentro.
   * Devuelve cuántas notificaciones nuevas generó.
   */
  runScheduledJobs(): number {
    let total = 0;
    for (const pet of this.state.pets) {
      if (pet.kind !== "lost" || pet.state !== "active") continue;
      const created = alertAudience(pet, this.alertCandidates(pet), this.now()).map((id) =>
        this.makeNotification(id, "life_circle", pet.id),
      );
      if (!created.length) continue;
      // Caso por caso: lo recién avisado cuenta para el límite diario del siguiente.
      this.commit({ notifications: [...created, ...this.state.notifications] });
      total += created.length;
    }
    return total;
  }

  async addSighting(petId: string, input: NewSightingInput): Promise<void> {
    const user = this.requireVerified();
    const pet = this.requirePet(petId);
    if (pet.state !== "active") throw new BackendError("not_allowed");
    const location = approximateLocation(input.location);
    const sighting = {
      id: this.id("s"),
      at: input.at,
      location,
      zone: input.zone,
      note: input.note?.trim() || undefined,
      authorId: user.id,
      authorShortName: shortName(user.name),
    };
    // Solo un avistamiento más reciente mueve el último punto conocido (y reinicia el círculo).
    const newer = new Date(input.at) > new Date(pet.lastSeenAt);
    const updated: PetCase = {
      ...pet,
      sightings: [sighting, ...pet.sightings],
      ...(newer ? { lastSeenAt: input.at, location, zone: input.zone } : {}),
    };
    const notifications =
      pet.ownerId !== user.id
        ? [this.makeNotification(pet.ownerId, "sighting", pet.id), ...this.state.notifications]
        : this.state.notifications;
    this.commit({
      pets: this.replacePet(updated),
      messages: [...this.state.messages, this.makeMessage(pet.groupId, "sighting", user, input.zone)],
      notifications,
    });
  }

  /**
   * Cierra el caso con un reencuentro. La familia puede agradecer a quienes ayudaron
   * ("Ángel de patas"): solo cuentan personas que de verdad participaron en el caso
   * (avistamientos, grupo o mensaje directo), para que la insignia no se pueda regalar.
   */
  async markReunited(petId: string, helperIds: string[] = []): Promise<void> {
    const user = this.requireUser();
    const pet = this.requirePet(petId);
    if (pet.ownerId !== user.id) throw new BackendError("not_allowed");
    if (pet.state !== "active") throw new BackendError("not_allowed");
    const allowed = new Set(reunionHelperCandidates(this.state, petId).map((c) => c.userId));
    const helpers = [...new Set(helperIds)].filter((id) => allowed.has(id)).slice(0, MAX_HELPERS);
    const thread = this.state.threads.find((t) => t.id === pet.groupId);
    // También quienes lo compartieron: así saben que ya pueden quitar la historia o el afiche.
    const sharers = Object.entries(this.state.shareLog)
      .filter(([, pets]) => pets.includes(petId))
      .map(([id]) => id);
    const recipients = [...new Set([...(thread?.memberIds ?? []), ...sharers])].filter(
      (id) => id !== user.id && !helpers.includes(id) && this.state.users[id],
    );
    this.commit({
      pets: this.replacePet({
        ...pet,
        state: "reunited",
        reunitedAt: this.iso(),
        ...(helpers.length ? { helperIds: helpers } : {}),
      }),
      // La historia del caso se quita: ya está en casa.
      stories: this.state.stories.filter((s) => s.petId !== petId),
      // Las ubicaciones compartidas en los mensajes directos del caso dejan de verse.
      messages: [
        ...this.hideLocations((m) => this.state.threads.some((t) => t.id === m.threadId && t.kind === "dm" && t.petId === petId)),
        this.makeMessage(pet.groupId, "system", user, "reunited"),
      ],
      notifications: [
        ...helpers.map((id) => this.makeNotification(id, "thanked", pet.id)),
        ...recipients.map((id) => this.makeNotification(id, "case_closed", pet.id)),
        ...this.state.notifications,
      ],
    });
  }

  /** Agrega una actualización a la historia del caso (solo la familia, con el caso activo). */
  async addStory(petId: string, input: { text: string; photo?: string }): Promise<StoryItem> {
    const user = this.requireVerified();
    const pet = this.requirePet(petId);
    if (pet.ownerId !== user.id || pet.state !== "active") throw new BackendError("not_allowed");
    const text = input.text.trim().slice(0, 140);
    if (!text && !input.photo) throw new BackendError("unknown");
    if (this.state.stories.filter((s) => s.petId === petId).length >= 20) throw new BackendError("story_full");
    const item: StoryItem = {
      id: this.id("sto"),
      petId,
      authorId: user.id,
      text,
      createdAt: this.iso(),
      ...(input.photo ? { photo: input.photo } : {}),
    };
    this.commit({ stories: [...this.state.stories, item] });
    return item;
  }

  /** Quita una actualización de la historia (su autor o la familia). */
  async removeStory(storyId: string): Promise<void> {
    const user = this.requireUser();
    const item = this.state.stories.find((s) => s.id === storyId);
    if (!item) return;
    const pet = this.getPet(item.petId);
    if (item.authorId !== user.id && pet?.ownerId !== user.id) throw new BackendError("not_allowed");
    this.commit({ stories: this.state.stories.filter((s) => s.id !== storyId) });
  }

  /** Aviso de dato incorrecto en una veterinaria (cerró, otro teléfono…). */
  async reportPlace(placeId: string, note: string): Promise<void> {
    this.requireUser();
    if (!note.trim()) throw new BackendError("unknown");
    if (!this.state.places.some((p) => p.id === placeId)) throw new BackendError("not_found");
  }

  async sharePet(petId: string): Promise<void> {
    const pet = this.requirePet(petId);
    const user = this.currentUser;
    const shared = user ? (this.state.shareLog[user.id] ?? []) : [];
    this.commit({
      pets: this.replacePet({ ...pet, shareCount: pet.shareCount + 1 }),
      ...(user && !shared.includes(petId) ? { shareLog: { ...this.state.shareLog, [user.id]: [...shared, petId] } } : {}),
    });
  }

  async reportPost(petId: string): Promise<void> {
    // La moderación real es proporcional al riesgo (docs/legal/moderacion-y-ugc.md);
    // en demo solo se valida que exista.
    this.requirePet(petId);
  }

  /**
   * Decisión del equipo de moderación (no la expone la app): el reporte se archiva y deja
   * de contar para insignias y estadísticas, que se recalculan solas.
   */
  applyModerationRemoval(petId: string): void {
    const pet = this.requirePet(petId);
    this.commit({
      pets: this.replacePet({ ...pet, moderationRemoved: true, state: pet.state === "active" ? "archived" : pet.state }),
    });
  }

  // --- Mis mascotas (perfil preventivo) --------------------------------------

  async saveOwnedPet(input: OwnedPetInput, id?: string): Promise<OwnedPet> {
    const user = this.requireUser();
    const clean: OwnedPetInput = {
      ...input,
      name: input.name.trim(),
      breed: input.breed?.trim() || undefined,
      color: input.color?.trim() || undefined,
      collar: input.collar?.trim() || undefined,
      marks: input.marks?.trim() || undefined,
      description: input.description.trim(),
      photos: input.photos.slice(0, 5),
    };
    if (!clean.name) throw new BackendError("unknown");
    if (id) {
      const existing = this.state.ownedPets.find((p) => p.id === id);
      if (!existing) throw new BackendError("not_found");
      if (existing.ownerId !== user.id) throw new BackendError("not_allowed");
      const updated = { ...existing, ...clean };
      this.commit({ ownedPets: this.state.ownedPets.map((p) => (p.id === id ? updated : p)) });
      return updated;
    }
    if (this.state.ownedPets.filter((p) => p.ownerId === user.id).length >= MAX_OWNED_PETS) {
      throw new BackendError("not_allowed");
    }
    const created: OwnedPet = { ...clean, id: this.id("own"), ownerId: user.id, createdAt: this.iso() };
    this.commit({ ownedPets: [...this.state.ownedPets, created] });
    return created;
  }

  async deleteOwnedPet(id: string): Promise<void> {
    const user = this.requireUser();
    const existing = this.state.ownedPets.find((p) => p.id === id);
    if (!existing) return;
    if (existing.ownerId !== user.id) throw new BackendError("not_allowed");
    this.commit({ ownedPets: this.state.ownedPets.filter((p) => p.id !== id) });
  }

  // --- Zona de Alertas Ángel --------------------------------------------------

  /** Guarda la zona aproximada (nunca el punto exacto) o la borra con null (revoca). */
  async setAlertZone(zone: AlertZone | null): Promise<void> {
    const user = this.requireUser();
    const zones = { ...this.state.alertZones };
    if (zone) zones[user.id] = { ...zone, location: approximateLocation(zone.location), updatedAt: this.iso() };
    else delete zones[user.id];
    this.commit({ alertZones: zones });
  }

  /**
   * Nuevo punto del GPS (alertas donde estés). Solo cuenta si la persona activó las alertas
   * por ubicación; se guarda aproximado y sin historial. Si sigue en la misma celda, solo se
   * renueva cada 30 minutos para no reescribir el estado en cada lectura.
   */
  async updateAlertLocation(point: LatLng, zoneName?: string): Promise<void> {
    const user = this.currentUser;
    const current = user ? this.state.alertZones[user.id] : undefined;
    if (!user || !current) return;
    const location = approximateLocation(point);
    const sameCell = location.latitude === current.location.latitude && location.longitude === current.location.longitude;
    const recent = current.updatedAt && this.now().getTime() - new Date(current.updatedAt).getTime() < 30 * 60_000;
    if (sameCell && recent && !zoneName) return;
    this.commit({
      alertZones: {
        ...this.state.alertZones,
        [user.id]: { location, zone: zoneName ?? current.zone, updatedAt: this.iso() },
      },
    });
  }

  // --- Mensajería ----------------------------------------------------------

  async joinGroup(petId: string): Promise<string> {
    const user = this.requireVerified();
    const pet = this.requirePet(petId);
    const thread = this.state.threads.find((t) => t.id === pet.groupId);
    if (!thread) throw new BackendError("not_found");
    if (thread.memberIds.includes(user.id)) return thread.id;
    if (thread.archived) throw new BackendError("not_allowed");
    this.commit({
      threads: this.state.threads.map((t) =>
        t.id === thread.id ? { ...t, memberIds: [...t.memberIds, user.id], readAt: { ...t.readAt, [user.id]: this.iso() } } : t,
      ),
      messages: [...this.state.messages, this.makeMessage(thread.id, "system", user, "joined")],
    });
    return thread.id;
  }

  async openDirect(petId: string): Promise<string> {
    const user = this.requireVerified();
    const pet = this.requirePet(petId);
    const otherId = pet.ownerId;
    if (otherId === user.id) throw new BackendError("not_allowed");
    const other = this.state.users[otherId];
    if (!other) throw new BackendError("not_found");
    const prefs = this.state.privacyPrefs[otherId] ?? DEFAULT_PRIVACY_PREFS;
    if (prefs.whoCanMessage === "nobody" || (prefs.whoCanMessage === "verified" && !user.verified)) {
      throw new BackendError("cannot_message");
    }
    // Un mensaje directo cerrado no se reabre: se abre uno nuevo.
    const existing = this.state.threads.find(
      (t) => t.kind === "dm" && !t.archived && t.memberIds.includes(user.id) && t.memberIds.includes(otherId),
    );
    if (existing) return existing.id;
    const thread: Thread = {
      id: this.id("dm"),
      kind: "dm",
      petId,
      memberIds: [user.id, otherId],
      readAt: { [user.id]: this.iso() },
      mutedBy: [],
      archived: false,
      archivedBy: [],
    };
    this.commit({ threads: [thread, ...this.state.threads] });
    return thread.id;
  }

  /** Cierra un mensaje directo para las dos personas. Los grupos no se cierran. */
  async closeDirect(threadId: string): Promise<void> {
    const user = this.requireUser();
    const thread = this.state.threads.find((t) => t.id === threadId);
    if (!thread || thread.kind !== "dm" || !thread.memberIds.includes(user.id)) throw new BackendError("not_allowed");
    if (thread.archived) return;
    this.commit({
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, archived: true, closedBy: user.id } : t)),
      messages: [...this.hideLocations((m) => m.threadId === threadId), this.makeMessage(threadId, "system", user, "closed")],
    });
  }

  /**
   * Mensajes con las ubicaciones de personas (actual y punto de encuentro) que cumplen el
   * filtro ya ocultas: se borra el punto y queda "ya no visible". Las veterinarias siguen
   * visibles porque son lugares públicos.
   */
  private hideLocations(match: (m: Message) => boolean): Message[] {
    return this.state.messages.map((m) =>
      m.location && m.location.kind !== "place" && !m.location.hidden && match(m) ? this.withoutLocation(m) : m,
    );
  }

  private withoutLocation(m: Message): Message {
    if (!m.location) return m;
    const { location: _point, ...rest } = m.location;
    return { ...m, location: { ...rest, hidden: true } };
  }

  /** Archiva o desarchiva un chat solo en la lista de quien lo pide. */
  async toggleArchive(threadId: string): Promise<boolean> {
    const user = this.requireUser();
    const thread = this.state.threads.find((t) => t.id === threadId);
    if (!thread || !thread.memberIds.includes(user.id)) throw new BackendError("not_allowed");
    const archived = !thread.archivedBy.includes(user.id);
    this.commit({
      threads: this.state.threads.map((t) =>
        t.id === threadId
          ? { ...t, archivedBy: archived ? [...t.archivedBy, user.id] : t.archivedBy.filter((id) => id !== user.id) }
          : t,
      ),
    });
    return archived;
  }

  /** Quita el chat de la lista de quien lo pide; para las demás personas sigue igual. */
  async leaveThread(threadId: string): Promise<void> {
    const user = this.requireUser();
    this.commit({
      threads: this.state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              memberIds: t.memberIds.filter((id) => id !== user.id),
              archivedBy: t.archivedBy.filter((id) => id !== user.id),
            }
          : t,
      ),
    });
  }

  async sendMessage(threadId: string, text: string, lang: Lang = "es", photo?: MessagePhoto): Promise<void> {
    const user = this.requireVerified();
    const thread = this.state.threads.find((t) => t.id === threadId);
    if (!thread || !thread.memberIds.includes(user.id) || thread.archived) throw new BackendError("not_allowed");
    const body = text.trim().slice(0, MESSAGE_MAX);
    if (!body && !photo) return;
    if (user.mutedUntil && new Date(user.mutedUntil) > this.now()) {
      throw new BackendError("muted", { until: user.mutedUntil });
    }
    this.assertMessageRate(user.id);
    // Se traduce una vez hacia cada idioma que usan los miembros, no por cada lector.
    const targets = new Set(
      thread.memberIds.map((id) => this.state.users[id]?.lang).filter((l): l is Lang => Boolean(l) && l !== lang),
    );
    const translations: Partial<Record<Lang, string>> = {};
    for (const to of body ? targets : []) {
      const translated = this.translator?.(body, lang, to);
      if (translated) translations[to] = translated;
    }
    const message: Message = {
      ...this.makeMessage(threadId, "text", user, body),
      lang,
      translations,
      ...(photo ? { photo } : {}),
    };
    this.commit({
      messages: [...this.state.messages, message],
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, readAt: { ...t.readAt, [user.id]: message.at } } : t)),
    });
  }

  /** Antispam: límite de mensajes por minuto (texto y ubicaciones), igual que la API. */
  private assertMessageRate(userId: string) {
    const minuteAgo = new Date(this.now().getTime() - 60_000).toISOString();
    const recent = this.state.messages.filter(
      (m) => m.authorId === userId && (m.kind === "text" || m.kind === "location") && m.at > minuteAgo,
    );
    if (recent.length >= MESSAGES_PER_MINUTE) throw new BackendError("rate_limited", {});
  }

  /**
   * Comparte una ubicación en un chat. No es en vivo: se envía ese punto una vez. La de una
   * persona (actual o punto de encuentro) solo va en mensajes directos; una veterinaria también
   * en el grupo del caso, y su nombre y punto salen de la lista de lugares.
   */
  async shareLocation(threadId: string, share: LocationShare, lang: Lang = "es"): Promise<void> {
    const user = this.requireVerified();
    const thread = this.state.threads.find((t) => t.id === threadId);
    if (!thread || !thread.memberIds.includes(user.id) || thread.archived) throw new BackendError("not_allowed");
    if (user.mutedUntil && new Date(user.mutedUntil) > this.now()) {
      throw new BackendError("muted", { until: user.mutedUntil });
    }
    let location: MessageLocation;
    if (share.kind === "place") {
      const place = this.state.places.find((p) => p.id === share.placeId);
      if (!place) throw new BackendError("not_found");
      location = {
        kind: "place",
        location: place.location,
        label: place.name,
        placeId: place.id,
        ...(place.address ? { address: place.address } : {}),
      };
    } else {
      if (thread.kind !== "dm") throw new BackendError("not_allowed");
      const label = share.kind === "meeting" ? share.label?.trim().slice(0, LOCATION_LABEL_MAX) : undefined;
      location = { kind: share.kind, location: share.location, ...(label ? { label } : {}) };
    }
    this.assertMessageRate(user.id);
    const message: Message = { ...this.makeMessage(threadId, "location", user, ""), lang, location };
    this.commit({
      messages: [...this.state.messages, message],
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, readAt: { ...t.readAt, [user.id]: message.at } } : t)),
    });
  }

  /** Quien compartió una ubicación la deja de mostrar cuando quiera. */
  async stopSharingLocation(messageId: string): Promise<void> {
    const user = this.requireUser();
    const message = this.state.messages.find((m) => m.id === messageId);
    if (!message) throw new BackendError("not_found");
    if (message.authorId !== user.id || message.kind !== "location") throw new BackendError("not_allowed");
    this.commit({ messages: this.state.messages.map((m) => (m.id === messageId ? this.withoutLocation(m) : m)) });
  }

  /** Idempotente: solo escribe si hay mensajes posteriores a la última lectura. */
  async markThreadRead(threadId: string): Promise<void> {
    const user = this.currentUser;
    const thread = this.state.threads.find((t) => t.id === threadId);
    if (!user || !thread) return;
    const latest = this.state.messages.reduce((max, m) => (m.threadId === threadId && m.at > max ? m.at : max), "");
    if ((thread.readAt[user.id] ?? "") >= latest) return;
    this.commit({
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, readAt: { ...t.readAt, [user.id]: latest } } : t)),
    });
  }

  async toggleMute(threadId: string): Promise<void> {
    const user = this.requireUser();
    this.commit({
      threads: this.state.threads.map((t) =>
        t.id === threadId
          ? { ...t, mutedBy: t.mutedBy.includes(user.id) ? t.mutedBy.filter((id) => id !== user.id) : [...t.mutedBy, user.id] }
          : t,
      ),
    });
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    this.commit({
      notifications: this.state.notifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
    });
  }

  async markAllNotificationsRead(): Promise<void> {
    const user = this.requireUser();
    this.commit({
      notifications: this.state.notifications.map((n) => (n.userId === user.id ? { ...n, read: true } : n)),
    });
  }

  private makeMessage(threadId: string, kind: MessageKind, author: User, text: string): Message {
    return {
      id: this.id("m"),
      threadId,
      authorId: author.id,
      authorShortName: shortName(author.name),
      text,
      at: this.iso(),
      kind,
    };
  }

  private makeNotification(userId: string, kind: NotificationKind, petId: string): AppNotification {
    return { id: this.id("n"), userId, kind, petId, at: this.iso(), read: false };
  }

  // --- Perfil, preferencias y privacidad ------------------------------------

  async updateProfile(patch: ProfilePatch): Promise<void> {
    const user = this.requireUser();
    if (patch.username !== undefined) {
      const username = patch.username.trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new BackendError("invalid_username");
      if (Object.values(this.state.users).some((u) => u.username === username && u.id !== user.id)) {
        throw new BackendError("username_taken");
      }
      patch = { ...patch, username };
    }
    if (patch.bio !== undefined) patch = { ...patch, bio: patch.bio.slice(0, 150) };
    if (patch.phone !== undefined) {
      // Opcional y sin verificar: solo se valida el formato.
      const phone = patch.phone.trim() ? normalizeColombianMobile(patch.phone) : "";
      if (phone === null) throw new BackendError("invalid_phone");
      patch = { ...patch, phone: phone || undefined };
    }
    this.commit({ users: { ...this.state.users, [user.id]: { ...user, ...patch } } });
  }

  /** La app informa el idioma elegido para que los chats lleguen traducidos a él. */
  async setLanguage(lang: Lang): Promise<void> {
    const user = this.currentUser;
    if (!user || user.lang === lang) return;
    this.commit({ users: { ...this.state.users, [user.id]: { ...user, lang } } });
  }

  notificationPrefsFor(userId: string): NotificationPrefs {
    return this.state.notificationPrefs[userId] ?? DEFAULT_NOTIFICATION_PREFS;
  }

  privacyPrefsFor(userId: string): PrivacyPrefs {
    return this.state.privacyPrefs[userId] ?? DEFAULT_PRIVACY_PREFS;
  }

  async updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<void> {
    const user = this.requireUser();
    this.commit({
      notificationPrefs: { ...this.state.notificationPrefs, [user.id]: { ...this.notificationPrefsFor(user.id), ...patch } },
    });
  }

  async updatePrivacy(patch: Partial<PrivacyPrefs>): Promise<void> {
    const user = this.requireUser();
    this.commit({ privacyPrefs: { ...this.state.privacyPrefs, [user.id]: { ...this.privacyPrefsFor(user.id), ...patch } } });
  }

  /**
   * "Me gusta" en el perfil de otra persona (o quitarlo). Solo cuentas verificadas, uno por
   * persona y nunca a uno mismo, para que el contador refleje confianza real.
   */
  async toggleProfileLike(userId: string): Promise<boolean> {
    const user = this.requireVerified();
    if (userId === user.id || !this.state.users[userId]) throw new BackendError("not_allowed");
    const likers = this.state.profileLikes[userId] ?? [];
    const liked = !likers.includes(user.id);
    this.commit({
      profileLikes: {
        ...this.state.profileLikes,
        [userId]: liked ? [...likers, user.id] : likers.filter((id) => id !== user.id),
      },
    });
    return liked;
  }

  /**
   * Reportar a una persona (spam, groserías, estafa…). No hay bloqueos: el equipo de
   * moderación revisa con contexto (el mensaje reportado) y decide la sanción.
   */
  async reportUser(input: { userId: string; reason: UserReportReason; threadId?: string; messageId?: string; note?: string }) {
    const user = this.requireUser();
    if (input.userId === user.id || !this.state.users[input.userId]) throw new BackendError("not_allowed");
    const duplicate = this.state.userReports.some(
      (r) => r.reporterId === user.id && r.reportedId === input.userId && r.messageId === input.messageId,
    );
    if (duplicate) return;
    const report: UserReport = {
      id: this.id("rep"),
      reporterId: user.id,
      reportedId: input.userId,
      reason: input.reason,
      threadId: input.threadId,
      messageId: input.messageId,
      note: input.note?.trim().slice(0, 300) || undefined,
      at: this.iso(),
    };
    this.commit({ userReports: [...this.state.userReports, report] });
  }

  /**
   * Sanción del equipo de moderación (no la expone la app): sin enviar mensajes por un
   * tiempo. Escalamiento: aviso → 24 h → 7 días → suspensión (docs/legal/moderacion-y-ugc.md).
   */
  applyModerationMute(userId: string, hours: number): void {
    const user = this.state.users[userId];
    if (!user) throw new BackendError("not_found");
    const mutedUntil = new Date(this.now().getTime() + hours * 3_600_000).toISOString();
    this.commit({ users: { ...this.state.users, [userId]: { ...user, mutedUntil } } });
  }

  // --- Cargadores ------------------------------------------------------------------
  // Con la API (ApiBackend) completan la copia local cuando una pantalla los necesita; en la
  // demostración todo el estado ya está en memoria, así que no hacen nada.

  async loadNearby(_center: LatLng): Promise<void> {}

  async loadPet(_petId: string): Promise<void> {}

  async loadThread(_threadId: string): Promise<void> {}

  async loadProfile(_userId: string): Promise<void> {}

  async loadStories(_center: LatLng): Promise<void> {}

  async loadPlaces(_center: LatLng): Promise<void> {}

  /** Con la API registra el celular para recibir push; en demostración se usan avisos locales. */
  async registerPushToken(_token: string, _platform: "android" | "ios"): Promise<void> {}

  /** Portabilidad (Ley 1581): todo lo que la cuenta generó, en JSON. */
  async exportData(): Promise<string> {
    const user = this.requireUser();
    const data = {
      exportedAt: this.iso(),
      profile: user,
      reports: this.state.pets.filter((p) => p.ownerId === user.id),
      messages: this.state.messages.filter((m) => m.authorId === user.id),
      notificationPrefs: this.notificationPrefsFor(user.id),
      privacyPrefs: this.privacyPrefsFor(user.id),
      ownedPets: this.state.ownedPets.filter((p) => p.ownerId === user.id),
      alertZone: this.state.alertZones[user.id] ?? null,
    };
    return JSON.stringify(data, null, 2);
  }

  /** Derecho al olvido: borra perfil y mensajes; los reportes activos se archivan. */
  async deleteAccount(): Promise<void> {
    const user = this.requireUser();
    for (const [email, entry] of this.credentials) if (entry.userId === user.id) this.credentials.delete(email);
    const users = { ...this.state.users };
    delete users[user.id];
    const alertZones = { ...this.state.alertZones };
    delete alertZones[user.id];
    const shareLog = { ...this.state.shareLog };
    delete shareLog[user.id];
    const profileLikes = Object.fromEntries(
      Object.entries(this.state.profileLikes)
        .filter(([target]) => target !== user.id)
        .map(([target, likers]) => [target, likers.filter((id) => id !== user.id)]),
    );
    this.commit({
      profileLikes,
      alertZones,
      shareLog,
      ownedPets: this.state.ownedPets.filter((p) => p.ownerId !== user.id),
      users,
      sessionUserId: null,
      verification: null,
      pets: this.state.pets.map((p) => (p.ownerId === user.id && p.state === "active" ? { ...p, state: "archived" } : p)),
      threads: this.state.threads
        .filter((t) => !(t.kind === "dm" && t.memberIds.includes(user.id)))
        .map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => id !== user.id) })),
      messages: this.state.messages
        .filter((m) => m.authorId !== user.id || m.kind !== "text")
        .map((m) => (m.authorId === user.id ? { ...m, authorId: "deleted", authorShortName: "" } : m)),
      notifications: this.state.notifications.filter((n) => n.userId !== user.id),
    });
  }
}
