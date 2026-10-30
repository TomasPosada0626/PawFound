import * as SecureStore from "expo-secure-store";

import type { BadgeProgress } from "@/domain/badges";
import { approximateLocation } from "@/domain/geo";
import { publishAllowance, type PublishAllowance } from "@/domain/rules";
import type {
  AlertZone,
  AppNotification,
  Lang,
  LatLng,
  LocationShare,
  Message,
  MessagePhoto,
  NotificationPrefs,
  OwnedPet,
  PetCase,
  Place,
  PrivacyPrefs,
  StoryItem,
  Thread,
  User,
  UserReportReason,
} from "@/domain/types";

import {
  BackendError,
  type BackendState,
  type ErrorCode,
  type NewReportInput,
  type NewSightingInput,
  type OwnedPetInput,
  type ProfilePatch,
  type SocialProvider,
} from "./backendTypes";
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_PRIVACY_PREFS } from "./mockBackend";
import { photoExists, shrinkPhoto } from "./photoShrink";
import { readJSON, writeJSON } from "./storage";

type NativeFiles = typeof import("expo-file-system/legacy");

/** Subida nativa de archivos (expo-file-system); null donde no existe (web, pruebas). */
function nativeFiles(): NativeFiles | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-file-system/legacy") as NativeFiles;
  } catch {
    return null;
  }
}

/**
 * Backend real: la misma interfaz que MockBackend, sobre la API de PawFound
 * (packages/contracts/openapi.yaml). Mantiene una copia local del estado que las pantallas ya
 * saben leer, la completa con la API (al entrar, con los cargadores load* y en vivo por
 * WebSocket) y la actualiza después de cada acción. Los tokens viven en SecureStore; el de
 * acceso se renueva solo con el refresh token.
 */

const TOKENS_KEY = "pawfound.tokens";
/** Última cuenta conocida: al abrir la app se muestra al instante mientras la API responde. */
const ME_KEY = "pawfound.me";
/** Resultado de renovar: "failed" es un problema de red o del servidor, no cierra la sesión. */
type RenewResult = "ok" | "rejected" | "failed";
const NEARBY_RADIUS = 20_000;
const RESEND_COOLDOWN_S = 45;

type Tokens = { access: string; refresh: string };
type Listener = () => void;

type ApiUser = {
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
};
type ApiSummary = {
  id: string;
  shortName: string;
  avatar: User["avatar"];
  photoUrl?: string;
  verified: boolean;
  createdAt: string;
  lang: Lang;
};
type ApiMe = {
  user: ApiUser;
  notificationPrefs: NotificationPrefs;
  privacyPrefs: PrivacyPrefs;
  alertZone: AlertZone | null;
  allowance: { allowed: boolean; retryAt?: string };
  activeSessions?: number;
};
type ApiSession = { accessToken: string; refreshToken: string; me: ApiMe; needsVerification: boolean };
type ApiPet = Omit<PetCase, "sightings"> & {
  sightings: (Omit<PetCase["sightings"][number], "authorId"> & { authorId?: string })[];
  owner?: ApiSummary;
};
type ApiMessage = Omit<Message, "photo"> & { photo?: { url: string; width: number; height: number } };
type ApiThread = Omit<Thread, "readAt"> & { readAt: Record<string, string>; members: ApiSummary[]; lastMessage?: ApiMessage };
type ApiStory = { pet: ApiPet; items: (Omit<StoryItem, "photo"> & { photo?: string })[] };
type ApiProfile = {
  user: Omit<ApiUser, "email">;
  likes: number;
  likedByMe: boolean;
  badges: BadgeProgress[];
  pets: { id: string; name: string; species: OwnedPet["species"]; photo?: string }[];
};

function emptyState(): BackendState {
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
    nearbyLoaded: false,
    threadsLoaded: false,
    activeSessions: 0,
  };
}

const KNOWN_CODES = new Set<ErrorCode>([
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

export class ApiBackend {
  private state: BackendState = emptyState();
  private listeners = new Set<Listener>();
  private tokens: Tokens | null = null;
  private allowance: PublishAllowance = { allowed: true };
  private codeSentAt = 0;
  private socket: WebSocket | null = null;
  private refreshing: Promise<RenewResult> | null = null;
  /** Token push registrado por este celular, para darlo de baja al cerrar sesión. */
  private pushToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  // --- External store ----------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BackendState => this.state;

  private commit(patch: Partial<BackendState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get currentUser(): User | null {
    const id = this.state.sessionUserId;
    return id ? (this.state.users[id] ?? null) : null;
  }

  private requireUser(): User {
    const user = this.currentUser;
    if (!user) throw new BackendError("not_allowed");
    return user;
  }

  // --- HTTP ----------------------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (this.tokens) headers.Authorization = `Bearer ${this.tokens.access}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch {
      throw new BackendError("network");
    }
    if (res.status === 401 && retry && this.tokens) {
      const renewed = await this.renew();
      if (renewed === "ok") return this.request<T>(method, path, body, false);
      if (renewed === "failed") throw new BackendError("network");
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as {
      error?: { code?: string; params?: Record<string, string | number> };
    } | null;
    if (!res.ok) {
      const code = data?.error?.code as ErrorCode | undefined;
      throw new BackendError(code && KNOWN_CODES.has(code) ? code : "unknown", data?.error?.params ?? {});
    }
    return data as T;
  }

  /**
   * Renueva el token de acceso con el refresh token (una sola vez aunque fallen varias
   * peticiones). La sesión solo se cierra si la API la rechaza (401/403): sin red, con la API
   * despertando (Render gratis) o con un límite de peticiones, se conserva y se reintenta luego.
   */
  private renew(): Promise<RenewResult> {
    if (!this.refreshing) {
      this.refreshing = (async (): Promise<RenewResult> => {
        try {
          const refresh = this.tokens?.refresh;
          if (!refresh) return "rejected";
          const res = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: refresh }),
          });
          if (res.status === 401 || res.status === 403) {
            await this.clearSession();
            return "rejected";
          }
          if (!res.ok) return "failed";
          const session = (await res.json()) as ApiSession;
          await this.saveTokens({ access: session.accessToken, refresh: session.refreshToken });
          return "ok";
        } catch {
          return "failed";
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  private async saveTokens(tokens: Tokens) {
    this.tokens = tokens;
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens)).catch(() => {});
  }

  private async clearSession() {
    this.tokens = null;
    this.socket?.close();
    this.socket = null;
    await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => {});
    await writeJSON(ME_KEY, null);
    this.state = emptyState();
    this.listeners.forEach((l) => l());
  }

  private async upload(uri: string, purpose: "pet" | "owned" | "chat" | "story" | "avatar"): Promise<string> {
    if (/^https?:\/\//.test(uri)) return uri; // ya está en el servidor
    // Una foto que ya no existe (borrador viejo) se reporta como tal, no como falta de internet.
    if (!(await photoExists(uri))) throw new BackendError("invalid_image");
    const small = await shrinkPhoto(uri);
    const media = await this.uploadFile(small, purpose);
    return media.id;
  }

  /**
   * Sube el archivo como multipart con el cargador nativo de Expo, más confiable en Android que
   * FormData con fetch. Renueva la sesión una vez si venció. Sin cargador nativo usa fetch.
   */
  private async uploadFile(fileUri: string, purpose: string, retry = true): Promise<{ id: string; url: string }> {
    const files = nativeFiles();
    if (!files) {
      const form = new FormData();
      form.append("purpose", purpose);
      form.append("file", { uri: fileUri, name: "foto.jpg", type: "image/jpeg" } as unknown as Blob);
      return this.request<{ id: string; url: string }>("POST", "/v1/media", form);
    }
    let res: Awaited<ReturnType<NativeFiles["uploadAsync"]>>;
    try {
      res = await files.uploadAsync(`${this.baseUrl}/v1/media`, fileUri, {
        httpMethod: "POST",
        uploadType: files.FileSystemUploadType.MULTIPART,
        fieldName: "file",
        mimeType: "image/jpeg",
        parameters: { purpose },
        headers: { Accept: "application/json", ...(this.tokens ? { Authorization: `Bearer ${this.tokens.access}` } : {}) },
      });
    } catch {
      throw new BackendError("network");
    }
    if (res.status === 401 && retry && this.tokens) {
      const renewed = await this.renew();
      if (renewed === "ok") return this.uploadFile(fileUri, purpose, false);
      if (renewed === "failed") throw new BackendError("network");
    }
    type UploadBody = { id?: string; url?: string; error?: { code?: string; params?: Record<string, string | number> } };
    let data: UploadBody | null;
    try {
      data = JSON.parse(res.body) as UploadBody;
    } catch {
      data = null;
    }
    if (res.status >= 300 || !data?.id) {
      const code = data?.error?.code as ErrorCode | undefined;
      throw new BackendError(code && KNOWN_CODES.has(code) ? code : "unknown", data?.error?.params ?? {});
    }
    return { id: data.id, url: data.url ?? "" };
  }

  // --- Conversión API → modelo de la app ------------------------------------------------

  private toUser(u: ApiUser | Omit<ApiUser, "email">): User {
    return {
      id: u.id,
      name: u.name,
      username: u.username,
      email: "email" in u ? u.email : "",
      phone: "phone" in u ? u.phone : undefined,
      verified: u.verified,
      avatar: u.avatar,
      photoUrl: u.photoUrl,
      title: u.title,
      bio: u.bio,
      city: u.city,
      neighborhood: u.neighborhood,
      createdAt: u.createdAt,
      mutedUntil: "mutedUntil" in u ? u.mutedUntil : undefined,
      ratingSum: 0,
      ratingCount: 0,
      lang: u.lang,
    };
  }

  /** Lo público de otras cuentas: nunca correo ni celular (la API no los envía). */
  private mergeSummaries(list: (ApiSummary | undefined)[]): Record<string, User> {
    const users = { ...this.state.users };
    for (const s of list) {
      if (!s || s.id === this.state.sessionUserId) continue;
      const known = users[s.id];
      users[s.id] = known
        ? { ...known, avatar: s.avatar, photoUrl: s.photoUrl, verified: s.verified }
        : {
            id: s.id,
            name: s.shortName,
            username: "",
            email: "",
            verified: s.verified,
            avatar: s.avatar,
            photoUrl: s.photoUrl,
            title: "animal_lover",
            bio: "",
            city: "",
            createdAt: s.createdAt,
            ratingSum: 0,
            ratingCount: 0,
            lang: s.lang,
          };
    }
    return users;
  }

  private toPet(p: ApiPet): PetCase {
    const { owner: _owner, ...rest } = p;
    return { ...rest, sightings: p.sightings.map((s) => ({ ...s, authorId: s.authorId ?? "" })) };
  }

  private toMessage(m: ApiMessage): Message {
    const { photo, ...rest } = m;
    return { ...rest, ...(photo ? { photo: { uri: photo.url, width: photo.width, height: photo.height } } : {}) };
  }

  private mergePets(list: ApiPet[]) {
    const byId = new Map(this.state.pets.map((p) => [p.id, p]));
    for (const p of list) byId.set(p.id, this.toPet(p));
    this.commit({ pets: [...byId.values()], users: this.mergeSummaries(list.map((p) => p.owner)) });
  }

  private mergeMessages(list: ApiMessage[]) {
    const byId = new Map(this.state.messages.map((m) => [m.id, m]));
    for (const m of list) byId.set(m.id, this.toMessage(m));
    this.commit({ messages: [...byId.values()] });
  }

  private applyMe(me: ApiMe) {
    void writeJSON(ME_KEY, me);
    const user = this.toUser(me.user);
    this.allowance = me.allowance.allowed
      ? { allowed: true }
      : { allowed: false, retryAt: new Date(me.allowance.retryAt ?? Date.now()) };
    const alertZones = { ...this.state.alertZones };
    if (me.alertZone) alertZones[user.id] = me.alertZone;
    else delete alertZones[user.id];
    this.commit({
      sessionUserId: user.id,
      users: { ...this.state.users, [user.id]: user },
      notificationPrefs: { ...this.state.notificationPrefs, [user.id]: me.notificationPrefs },
      privacyPrefs: { ...this.state.privacyPrefs, [user.id]: me.privacyPrefs },
      alertZones,
      activeSessions: Math.max(1, me.activeSessions ?? 1),
    });
  }

  private async startSession(session: ApiSession) {
    await this.saveTokens({ access: session.accessToken, refresh: session.refreshToken });
    this.applyMe(session.me);
    void this.sync();
  }

  /** Lo que la app necesita al entrar: bandeja, chats, mis reportes, mis mascotas. */
  private async sync() {
    if (!this.tokens) return;
    try {
      const [notifications, threads, mine, owned] = await Promise.all([
        this.request<AppNotification[]>("GET", "/v1/me/notifications"),
        this.request<ApiThread[]>("GET", "/v1/threads"),
        this.request<ApiPet[]>("GET", "/v1/me/pets"),
        this.request<OwnedPet[]>("GET", "/v1/me/owned-pets"),
      ]);
      this.mergePets(mine);
      this.applyThreads(threads);
      this.commit({ notifications, ownedPets: owned });
      const missing = [...new Set(notifications.map((n) => n.petId))].filter((id) => !this.state.pets.some((p) => p.id === id));
      await Promise.all(missing.slice(0, 20).map((id) => this.loadPet(id)));
      this.connectRealtime();
    } catch {
      // Sin red: se reintenta en la próxima sincronización periódica.
    } finally {
      if (!this.state.threadsLoaded) this.commit({ threadsLoaded: true });
    }
  }

  private applyThreads(list: ApiThread[]) {
    const byId = new Map(this.state.threads.map((t) => [t.id, t]));
    const last: ApiMessage[] = [];
    for (const t of list) {
      const { members: _members, lastMessage, unread: _unread, ...thread } = t as ApiThread & { unread?: number };
      byId.set(t.id, thread as Thread);
      if (lastMessage) last.push(lastMessage);
    }
    this.commit({ threads: [...byId.values()], users: this.mergeSummaries(list.flatMap((t) => t.members)) });
    this.mergeMessages(last);
  }

  /** Mensajes y notificaciones en vivo. El token va en el primer mensaje, nunca en la URL. */
  private connectRealtime() {
    if (this.socket || !this.tokens || typeof WebSocket === "undefined") return;
    const socket = new WebSocket(`${this.baseUrl.replace(/^http/, "ws")}/v1/ws`);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: this.tokens?.access }));
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as { type: string; data?: unknown };
        if (data.type === "message") this.mergeMessages([data.data as ApiMessage]);
        if (data.type === "notification") {
          const n = data.data as AppNotification;
          if (!this.state.notifications.some((x) => x.id === n.id))
            this.commit({ notifications: [n, ...this.state.notifications] });
          if (!this.state.pets.some((p) => p.id === n.petId)) void this.loadPet(n.petId);
        }
      } catch {
        // Evento desconocido: se ignora.
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
    };
  }

  // --- Cuenta ----------------------------------------------------------------------------

  async login(identifier: string, password: string): Promise<{ needsVerification: boolean }> {
    const session = await this.request<ApiSession>("POST", "/v1/auth/login", { identifier, password });
    await this.startSession(session);
    if (session.needsVerification) this.codeSentAt = Date.now();
    return { needsVerification: session.needsVerification };
  }

  /** Requiere el SDK de Google/Apple con su client ID (pendiente de configurar). */
  async loginWithProvider(_provider: SocialProvider): Promise<void> {
    throw new BackendError("provider_unavailable");
  }

  async register(input: { name: string; email: string; username: string; password: string }): Promise<void> {
    const session = await this.request<ApiSession>("POST", "/v1/auth/register", {
      ...input,
      lang: "es",
      acceptTerms: true,
      confirmAge: true,
    });
    this.codeSentAt = Date.now();
    await this.startSession(session);
  }

  async sendVerificationCode(): Promise<void> {
    if (this.secondsUntilResend() > 0) return;
    await this.resendCode();
  }

  secondsUntilResend(): number {
    return Math.max(0, RESEND_COOLDOWN_S - (Date.now() - this.codeSentAt) / 1000);
  }

  async resendCode(): Promise<void> {
    await this.request("POST", "/v1/auth/email/resend");
    this.codeSentAt = Date.now();
  }

  async verifyCode(code: string): Promise<void> {
    const me = await this.request<ApiMe>("POST", "/v1/auth/email/verify", { code });
    this.applyMe(me);
  }

  async logout(): Promise<void> {
    // Primero se da de baja este celular: tras cerrar sesión no debe recibir las alertas de la
    // cuenta (importa en celulares compartidos).
    if (this.tokens && this.pushToken) {
      await this.request("DELETE", "/v1/me/devices", { token: this.pushToken }).catch(() => {});
    }
    if (this.tokens) await this.request("POST", "/v1/auth/logout", { refreshToken: this.tokens.refresh }).catch(() => {});
    this.pushToken = null;
    await this.clearSession();
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.request("POST", "/v1/auth/password-reset", { email });
  }

  /**
   * Restaura la sesión guardada: muestra al instante la última cuenta conocida y la confirma con
   * la API en segundo plano. La sesión sigue abierta hasta que la persona la cierre o la API la
   * rechace; sin red o con la API despertando, se reintenta.
   */
  async restoreSession(_userId: string): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY).catch(() => null);
    if (!raw) return false;
    this.tokens = JSON.parse(raw) as Tokens;
    const cached = await readJSON<ApiMe>(ME_KEY);
    if (cached?.user) this.applyMe(cached);
    void this.confirmSession();
    return true;
  }

  /** Confirma la sesión con la API; reintenta con espera creciente (hasta unos 2 minutos). */
  private async confirmSession(attempt = 0): Promise<void> {
    try {
      this.applyMe(await this.request<ApiMe>("GET", "/v1/me"));
      await this.sync();
    } catch (e) {
      if (e instanceof BackendError && (e.code === "unauthorized" || e.code === "suspended")) {
        await this.clearSession();
        return;
      }
      if (this.tokens && attempt < 6) {
        setTimeout(() => void this.confirmSession(attempt + 1), Math.min(30_000, 2_000 * 2 ** attempt));
      }
    }
  }

  // --- Reportes --------------------------------------------------------------------------

  publishAllowanceFor(_userId: string): PublishAllowance {
    return this.allowance.allowed ? this.allowance : publishAllowance([], new Date());
  }

  async createReport(input: NewReportInput): Promise<PetCase> {
    const photos = await Promise.all(input.photos.map((uri) => this.upload(uri, "pet")));
    const pet = await this.request<ApiPet>("POST", "/v1/pets", { ...input, photos });
    this.mergePets([pet]);
    void this.request<ApiMe>("GET", "/v1/me").then(
      (me) => this.applyMe(me),
      () => {},
    );
    void this.sync();
    return this.toPet(pet);
  }

  getPet(petId: string): PetCase | undefined {
    return this.state.pets.find((p) => p.id === petId);
  }

  /** Las tareas periódicas las hace el servidor; aquí solo se sincroniza la bandeja. */
  runScheduledJobs(): number {
    void this.sync();
    return 0;
  }

  async addSighting(petId: string, input: NewSightingInput): Promise<void> {
    this.mergePets([await this.request<ApiPet>("POST", `/v1/pets/${petId}/sightings`, input)]);
  }

  async markReunited(petId: string, helperIds: string[] = []): Promise<void> {
    this.mergePets([await this.request<ApiPet>("POST", `/v1/pets/${petId}/reunite`, { helperIds })]);
    this.commit({ stories: this.state.stories.filter((s) => s.petId !== petId) });
  }

  async addStory(petId: string, input: { text: string; photo?: string }): Promise<StoryItem> {
    const photoId = input.photo ? await this.upload(input.photo, "story") : undefined;
    const item = await this.request<StoryItem>("POST", `/v1/pets/${petId}/stories`, { text: input.text, photoId });
    this.commit({ stories: [...this.state.stories, item] });
    return item;
  }

  async removeStory(storyId: string): Promise<void> {
    await this.request("DELETE", `/v1/stories/${storyId}`);
    this.commit({ stories: this.state.stories.filter((s) => s.id !== storyId) });
  }

  async reportPlace(placeId: string, note: string): Promise<void> {
    await this.request("POST", `/v1/places/${placeId}/report`, { note });
  }

  async sharePet(petId: string): Promise<void> {
    await this.request("POST", `/v1/pets/${petId}/share`);
  }

  async reportPost(petId: string): Promise<void> {
    await this.request("POST", `/v1/pets/${petId}/report`, { reason: "other" });
  }

  /** Solo existe en la demostración: en producción lo decide el panel de moderación. */
  applyModerationRemoval(_petId: string): void {
    throw new BackendError("not_allowed");
  }

  // --- Mis mascotas y ubicación -------------------------------------------------------------

  async saveOwnedPet(input: OwnedPetInput, id?: string): Promise<OwnedPet> {
    const photos = await Promise.all(input.photos.map((uri) => this.upload(uri, "owned")));
    const pet = await this.request<OwnedPet>(id ? "PUT" : "POST", id ? `/v1/me/owned-pets/${id}` : "/v1/me/owned-pets", {
      ...input,
      photos,
    });
    const others = this.state.ownedPets.filter((p) => p.id !== pet.id);
    this.commit({ ownedPets: [...others, pet] });
    return pet;
  }

  async deleteOwnedPet(id: string): Promise<void> {
    await this.request("DELETE", `/v1/me/owned-pets/${id}`);
    this.commit({ ownedPets: this.state.ownedPets.filter((p) => p.id !== id) });
  }

  async setAlertZone(zone: AlertZone | null): Promise<void> {
    const user = this.requireUser();
    const alertZones = { ...this.state.alertZones };
    if (zone) alertZones[user.id] = (await this.request<AlertZone>("PUT", "/v1/me/location", zone)) ?? zone;
    else {
      await this.request("DELETE", "/v1/me/location");
      delete alertZones[user.id];
    }
    this.commit({ alertZones });
  }

  async updateAlertLocation(point: LatLng, zoneName?: string): Promise<void> {
    const user = this.currentUser;
    const current = user ? this.state.alertZones[user.id] : undefined;
    if (!user || !current) return;
    await this.setAlertZone({ location: point, zone: zoneName ?? current.zone }).catch(() => {});
  }

  // --- Chats -----------------------------------------------------------------------------

  async joinGroup(petId: string): Promise<string> {
    const { threadId } = await this.request<{ threadId: string }>("POST", `/v1/pets/${petId}/join`);
    await this.loadThread(threadId);
    return threadId;
  }

  async openDirect(petId: string): Promise<string> {
    const { threadId } = await this.request<{ threadId: string }>("POST", `/v1/pets/${petId}/direct`);
    await this.loadThread(threadId);
    return threadId;
  }

  async closeDirect(threadId: string): Promise<void> {
    await this.request("POST", `/v1/threads/${threadId}/close`);
    await this.loadThread(threadId);
  }

  async toggleArchive(threadId: string): Promise<boolean> {
    const { archived } = await this.request<{ archived: boolean }>("POST", `/v1/threads/${threadId}/archive`);
    const me = this.requireUser().id;
    this.commit({
      threads: this.state.threads.map((t) =>
        t.id === threadId ? { ...t, archivedBy: archived ? [...t.archivedBy, me] : t.archivedBy.filter((id) => id !== me) } : t,
      ),
    });
    return archived;
  }

  async leaveThread(threadId: string): Promise<void> {
    await this.request("DELETE", `/v1/threads/${threadId}`);
    const me = this.requireUser().id;
    this.commit({
      threads: this.state.threads.map((t) =>
        t.id === threadId ? { ...t, memberIds: t.memberIds.filter((id) => id !== me) } : t,
      ),
    });
  }

  async sendMessage(threadId: string, text: string, lang: Lang = "es", photo?: MessagePhoto): Promise<void> {
    const photoId = photo ? await this.upload(photo.uri, "chat") : undefined;
    const message = await this.request<ApiMessage>("POST", `/v1/threads/${threadId}/messages`, { text, lang, photoId });
    this.mergeMessages([message]);
  }

  async shareLocation(threadId: string, share: LocationShare, lang: Lang = "es"): Promise<void> {
    const location =
      share.kind === "place"
        ? { kind: "place", placeId: share.placeId }
        : { kind: share.kind, location: share.location, label: share.label };
    const message = await this.request<ApiMessage>("POST", `/v1/threads/${threadId}/messages`, { text: "", lang, location });
    this.mergeMessages([message]);
  }

  async stopSharingLocation(messageId: string): Promise<void> {
    this.mergeMessages([await this.request<ApiMessage>("DELETE", `/v1/messages/${messageId}/location`)]);
  }

  async markThreadRead(threadId: string): Promise<void> {
    await this.request("POST", `/v1/threads/${threadId}/read`).catch(() => {});
    const me = this.state.sessionUserId;
    if (!me) return;
    const latest = this.state.messages.reduce((max, m) => (m.threadId === threadId && m.at > max ? m.at : max), "");
    this.commit({
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, readAt: { ...t.readAt, [me]: latest } } : t)),
    });
  }

  async toggleMute(threadId: string): Promise<void> {
    const { muted } = await this.request<{ muted: boolean }>("POST", `/v1/threads/${threadId}/mute`);
    const me = this.requireUser().id;
    this.commit({
      threads: this.state.threads.map((t) => (t.id === threadId ? { ...t, mutedBy: muted ? [me] : [] } : t)),
    });
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    this.commit({ notifications: this.state.notifications.map((n) => (n.id === notificationId ? { ...n, read: true } : n)) });
    await this.request("POST", `/v1/me/notifications/${notificationId}/read`).catch(() => {});
  }

  async markAllNotificationsRead(): Promise<void> {
    this.commit({ notifications: this.state.notifications.map((n) => ({ ...n, read: true })) });
    await this.request("POST", "/v1/me/notifications/read-all").catch(() => {});
  }

  // --- Perfil y preferencias -------------------------------------------------------------

  async updateProfile(patch: ProfilePatch): Promise<void> {
    this.applyMe(await this.request<ApiMe>("PATCH", "/v1/me", patch));
  }

  /** Sube la foto de perfil (achicada, sin datos de ubicación) o la quita con null. */
  async setProfilePhoto(uri: string | null): Promise<void> {
    const photoId = uri ? await this.upload(uri, "avatar") : "";
    this.applyMe(await this.request<ApiMe>("PATCH", "/v1/me", { photoId }));
  }

  async setLanguage(lang: Lang): Promise<void> {
    if (!this.currentUser || this.currentUser.lang === lang) return;
    await this.request("PUT", "/v1/me/lang", { lang });
    const user = this.currentUser;
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
    const prefs = await this.request<NotificationPrefs>("PUT", "/v1/me/notification-prefs", patch);
    this.commit({ notificationPrefs: { ...this.state.notificationPrefs, [user.id]: prefs } });
  }

  async updatePrivacy(patch: Partial<PrivacyPrefs>): Promise<void> {
    const user = this.requireUser();
    const next = { ...this.privacyPrefsFor(user.id), ...patch };
    await this.request("PUT", "/v1/me/privacy", next);
    this.commit({ privacyPrefs: { ...this.state.privacyPrefs, [user.id]: next } });
  }

  async toggleProfileLike(userId: string): Promise<boolean> {
    const { liked, likes } = await this.request<{ liked: boolean; likes: number }>("POST", `/v1/users/${userId}/like`);
    this.setLikes(userId, likes, liked);
    return liked;
  }

  /** El contador viene de la API; la lista local solo sirve para "me gusta" propio y el total. */
  private setLikes(userId: string, likes: number, likedByMe: boolean) {
    const me = this.state.sessionUserId ?? "";
    const others = Array.from({ length: Math.max(0, likes - (likedByMe ? 1 : 0)) }, (_, i) => `remote_${i}`);
    this.commit({ profileLikes: { ...this.state.profileLikes, [userId]: likedByMe ? [...others, me] : others } });
  }

  async reportUser(input: { userId: string; reason: UserReportReason; threadId?: string; messageId?: string; note?: string }) {
    await this.request("POST", `/v1/users/${input.userId}/report`, input);
  }

  /** Solo en la demostración (las sanciones se aplican en el panel de moderación). */
  applyModerationMute(_userId: string, _hours: number): void {
    throw new BackendError("not_allowed");
  }

  async exportData(): Promise<string> {
    return JSON.stringify(await this.request<unknown>("GET", "/v1/me/export"), null, 2);
  }

  async deleteAccount(): Promise<void> {
    await this.request("DELETE", "/v1/me");
    await this.clearSession();
  }

  // --- Cargadores: completan la copia local cuando una pantalla los necesita -----------------

  async loadNearby(center: LatLng): Promise<void> {
    try {
      const list = await this.request<ApiPet[]>(
        "GET",
        `/v1/pets?lat=${center.latitude}&lng=${center.longitude}&radius=${NEARBY_RADIUS}`,
      );
      this.mergePets(list);
    } finally {
      // Con o sin éxito termina la espera: sin red se muestra el estado vacío, no esqueletos eternos.
      if (!this.state.nearbyLoaded) this.commit({ nearbyLoaded: true });
    }
  }

  async loadPet(petId: string): Promise<void> {
    try {
      this.mergePets([await this.request<ApiPet>("GET", `/v1/pets/${petId}`)]);
    } catch (e) {
      if (!(e instanceof BackendError && e.code === "not_found")) throw e;
    }
  }

  async loadThread(threadId: string): Promise<void> {
    const [thread, messages] = await Promise.all([
      this.request<ApiThread>("GET", `/v1/threads/${threadId}`),
      this.request<ApiMessage[]>("GET", `/v1/threads/${threadId}/messages`),
    ]);
    this.applyThreads([thread]);
    this.mergeMessages(messages);
    if (thread.petId && !this.getPet(thread.petId)) await this.loadPet(thread.petId);
  }

  async loadProfile(userId: string): Promise<void> {
    const p = await this.request<ApiProfile>("GET", `/v1/users/${userId}`);
    const known = this.state.users[userId];
    const user = { ...this.toUser({ ...p.user }), email: known?.email ?? "", phone: known?.phone };
    const ownedPets = [
      ...this.state.ownedPets.filter((o) => o.ownerId !== userId || userId === this.state.sessionUserId),
      ...(userId === this.state.sessionUserId
        ? []
        : p.pets.map((pet) => ({
            id: pet.id,
            ownerId: userId,
            name: pet.name,
            species: pet.species,
            sex: "unknown" as const,
            age: "unknown" as const,
            size: "medium" as const,
            description: "",
            photos: pet.photo ? [pet.photo] : [],
            shyOrIndoor: false,
            createdAt: user.createdAt,
          }))),
    ];
    this.commit({
      users: { ...this.state.users, [userId]: user },
      remoteBadges: { ...this.state.remoteBadges, [userId]: p.badges },
      ownedPets,
    });
    this.setLikes(userId, p.likes, p.likedByMe);
  }

  async loadStories(center: LatLng): Promise<void> {
    const list = await this.request<ApiStory[]>("GET", `/v1/stories?lat=${center.latitude}&lng=${center.longitude}`);
    this.mergePets(list.map((s) => s.pet));
    const ids = new Set(list.map((s) => s.pet.id));
    this.commit({
      stories: [...this.state.stories.filter((s) => !ids.has(s.petId)), ...list.flatMap((s) => s.items as StoryItem[])],
    });
  }

  async registerPushToken(token: string, platform: "android" | "ios"): Promise<void> {
    if (!this.tokens) return;
    await this.request("POST", "/v1/me/devices", { token, platform });
    this.pushToken = token;
  }

  async loadPlaces(center: LatLng): Promise<void> {
    // Al servidor solo llega una celda de ~1 km: las distancias exactas se calculan en el celular.
    const cell = approximateLocation(center, 1000);
    const { places } = await this.request<{ places: Place[] }>(
      "GET",
      `/v1/places?lat=${cell.latitude.toFixed(4)}&lng=${cell.longitude.toFixed(4)}&radius=15000`,
    );
    this.commit({ places });
  }
}
