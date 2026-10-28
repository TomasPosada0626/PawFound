import { approximateLocation } from "@/domain/geo";
import { findPossibleMatches, publishAllowance } from "@/domain/rules";
import type {
  AppNotification,
  Lang,
  Message,
  MessageKind,
  NotificationKind,
  NotificationPrefs,
  PetCase,
  PrivacyPrefs,
  Thread,
  User,
} from "@/domain/types";
import { shortName } from "@/domain/privacy";
import { normalizeColombianMobile } from "@/domain/validation";

import {
  BackendError,
  type BackendState,
  type NewReportInput,
  type NewSightingInput,
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

export const DEMO_SMS_CODE = "123456";
export const RESEND_COOLDOWN_S = 45;
export const CODE_TTL_MIN = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const LOCK_MINUTES = 5;
export const MESSAGE_MAX = 1000;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  lostNearby: true,
  foundNearby: true,
  comments: true,
  directMessages: true,
  groups: true,
  lifeCircle: true,
  quietHours: false,
  quietFrom: "22:00",
  quietTo: "07:00",
  push: true,
  email: true,
  dailyDigest: false,
};

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = { whoCanMessage: "everyone", blockedUserIds: [] };

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
    if (!user.phoneVerified) throw new BackendError("not_allowed");
    return user;
  }

  async login(email: string, password: string): Promise<{ needsVerification: boolean }> {
    const entry = this.credentials.get(email.trim().toLowerCase());
    // Mismo error para correo inexistente y contraseña incorrecta: no revela si la cuenta existe.
    if (!entry || entry.password !== password) throw new BackendError("invalid_credentials");
    const user = this.state.users[entry.userId];
    if (!user) throw new BackendError("invalid_credentials");
    this.commit({ sessionUserId: user.id });
    if (!user.phoneVerified && user.phone) {
      this.issueCode(user.id, user.phone);
      return { needsVerification: true };
    }
    return { needsVerification: false };
  }

  async loginWithProvider(provider: SocialProvider): Promise<{ needsPhone: boolean }> {
    const email = `demo.${provider}@pawfound.app`;
    let user = Object.values(this.state.users).find((u) => u.email === email);
    if (!user) {
      user = this.makeUser({ name: `Persona ${provider[0]?.toUpperCase()}${provider.slice(1)}`, email });
      this.commit({ users: { ...this.state.users, [user.id]: user } });
    }
    this.commit({ sessionUserId: user.id });
    return { needsPhone: !user.phoneVerified };
  }

  async register(input: { name: string; email: string; phone: string; password: string }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    if (this.credentials.has(email)) throw new BackendError("email_taken");
    const phone = normalizeColombianMobile(input.phone);
    if (!phone) throw new BackendError("invalid_phone");
    if (this.phoneTaken(phone)) throw new BackendError("phone_taken");
    const user = this.makeUser({ name: input.name.trim(), email, phone });
    this.credentials.set(email, { userId: user.id, password: input.password });
    this.commit({ users: { ...this.state.users, [user.id]: user }, sessionUserId: user.id });
    this.issueCode(user.id, phone);
  }

  private makeUser({ name, email, phone }: { name: string; email: string; phone?: string }): User {
    const base =
      email
        .split("@")[0]
        ?.replace(/[^a-z0-9_]/gi, "")
        .toLowerCase() || "pawfriend";
    let username = base.slice(0, 16);
    while (Object.values(this.state.users).some((u) => u.username === username)) {
      username = `${base.slice(0, 14)}${Math.floor(Math.random() * 90 + 10)}`;
    }
    return {
      id: this.id("u"),
      name,
      username,
      email,
      phone,
      phoneVerified: false,
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

  private phoneTaken(phone: string, exceptUserId?: string) {
    return Object.values(this.state.users).some((u) => u.phone === phone && u.phoneVerified && u.id !== exceptUserId);
  }

  private issueCode(userId: string, phone: string) {
    this.commit({
      verification: { userId, phone, code: DEMO_SMS_CODE, sentAt: this.iso(), attempts: 0 },
    });
  }

  /** Paso "agrega y verifica tu número" (login social o cuenta sin teléfono). */
  async startPhoneVerification(rawPhone: string): Promise<void> {
    const user = this.requireUser();
    const phone = normalizeColombianMobile(rawPhone);
    if (!phone) throw new BackendError("invalid_phone");
    if (this.phoneTaken(phone, user.id)) throw new BackendError("phone_taken");
    this.commit({ users: { ...this.state.users, [user.id]: { ...user, phone, phoneVerified: false } } });
    this.issueCode(user.id, phone);
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
    this.commit({ verification: { ...v, sentAt: this.iso(), code: DEMO_SMS_CODE } });
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
    // Al verificar se otorga la insignia azul automáticamente (PRODUCT.md).
    this.commit({
      users: { ...this.state.users, [user.id]: { ...user, phone: v.phone, phoneVerified: true } },
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
    };
    const matches = findPossibleMatches(pet, this.state.pets, this.now());
    const matchNotifications = matches.map((m) => this.makeNotification(m.pet.ownerId, "possible_match", petId));
    this.commit({
      pets: [pet, ...this.state.pets],
      threads: [thread, ...this.state.threads],
      messages: [...this.state.messages, this.makeMessage(groupId, "system", user, "created")],
      notifications: [...matchNotifications, ...this.state.notifications],
      reportLog: { ...this.state.reportLog, [user.id]: [...(this.state.reportLog[user.id] ?? []), now] },
    });
    return pet;
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

  async markReunited(petId: string): Promise<void> {
    const user = this.requireUser();
    const pet = this.requirePet(petId);
    if (pet.ownerId !== user.id) throw new BackendError("not_allowed");
    const thread = this.state.threads.find((t) => t.id === pet.groupId);
    const recipients = (thread?.memberIds ?? []).filter((id) => id !== user.id);
    this.commit({
      pets: this.replacePet({ ...pet, state: "reunited", reunitedAt: this.iso() }),
      threads: this.state.threads.map((t) => (t.id === pet.groupId ? { ...t, archived: true } : t)),
      messages: [...this.state.messages, this.makeMessage(pet.groupId, "system", user, "reunited")],
      notifications: [...recipients.map((id) => this.makeNotification(id, "case_closed", pet.id)), ...this.state.notifications],
    });
  }

  async sharePet(petId: string): Promise<void> {
    const pet = this.requirePet(petId);
    this.commit({ pets: this.replacePet({ ...pet, shareCount: pet.shareCount + 1 }) });
  }

  async reportPost(petId: string): Promise<void> {
    // La moderación real es proporcional al riesgo (docs/legal/moderacion-y-ugc.md);
    // en demo solo se valida que exista.
    this.requirePet(petId);
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
    if (prefs.blockedUserIds.includes(user.id) || prefs.whoCanMessage === "nobody") {
      throw new BackendError("cannot_message");
    }
    const existing = this.state.threads.find(
      (t) => t.kind === "dm" && t.memberIds.includes(user.id) && t.memberIds.includes(otherId),
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
    };
    this.commit({ threads: [thread, ...this.state.threads] });
    return thread.id;
  }

  async sendMessage(threadId: string, text: string, lang: Lang = "es"): Promise<void> {
    const user = this.requireVerified();
    const thread = this.state.threads.find((t) => t.id === threadId);
    if (!thread || !thread.memberIds.includes(user.id) || thread.archived) throw new BackendError("not_allowed");
    const body = text.trim().slice(0, MESSAGE_MAX);
    if (!body) return;
    // Se traduce una vez hacia cada idioma que usan los miembros, no por cada lector.
    const targets = new Set(
      thread.memberIds.map((id) => this.state.users[id]?.lang).filter((l): l is Lang => Boolean(l) && l !== lang),
    );
    const translations: Partial<Record<Lang, string>> = {};
    for (const to of targets) {
      const translated = this.translator?.(body, lang, to);
      if (translated) translations[to] = translated;
    }
    const message = { ...this.makeMessage(threadId, "text", user, body), lang, translations };
    this.commit({
      messages: [...this.state.messages, message],
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, readAt: { ...t.readAt, [user.id]: message.at } } : t)),
    });
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

  async blockUser(userId: string): Promise<void> {
    const user = this.requireUser();
    const prefs = this.privacyPrefsFor(user.id);
    if (userId === user.id || prefs.blockedUserIds.includes(userId)) return;
    await this.updatePrivacy({ blockedUserIds: [...prefs.blockedUserIds, userId] });
  }

  async unblockUser(userId: string): Promise<void> {
    const user = this.requireUser();
    const prefs = this.privacyPrefsFor(user.id);
    await this.updatePrivacy({ blockedUserIds: prefs.blockedUserIds.filter((id) => id !== userId) });
  }

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
    };
    return JSON.stringify(data, null, 2);
  }

  /** Derecho al olvido: borra perfil y mensajes; los reportes activos se archivan. */
  async deleteAccount(): Promise<void> {
    const user = this.requireUser();
    for (const [email, entry] of this.credentials) if (entry.userId === user.id) this.credentials.delete(email);
    const users = { ...this.state.users };
    delete users[user.id];
    this.commit({
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
