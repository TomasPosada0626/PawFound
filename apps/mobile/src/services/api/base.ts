import * as SecureStore from "expo-secure-store";

import type { PublishAllowance } from "@/domain/rules";
import type { AppNotification, LatLng, Message, OwnedPet, PetCase, Thread, User } from "@/domain/types";

import { BackendError, type BackendState, type ErrorCode } from "../backendTypes";

import { photoExists, shrinkPhoto } from "../photoShrink";
import { stopAlertLocation } from "../alertLocation";

import { ME_KEY, TOKENS_KEY } from "../sessionKeys";
import { writeJSON } from "../storage";

import {
  type NativeFiles,
  nativeFiles,
  type RenewResult,
  type Tokens,
  type Listener,
  type ApiUser,
  type ApiSummary,
  type ApiMe,
  type ApiSession,
  type ApiPet,
  type ApiMessage,
  type ApiThread,
  emptyState,
  KNOWN_CODES,
} from "./shared";

/** Estado local, peticiones HTTP con renovación de la sesión, tiempo real y conversión de lo que responde la API. */
export abstract class ApiBase {
  protected state: BackendState = emptyState();
  protected listeners = new Set<Listener>();
  protected tokens: Tokens | null = null;
  protected allowance: PublishAllowance = { allowed: true };
  protected codeSentAt = 0;
  protected socket: WebSocket | null = null;
  protected nearbyCenter: LatLng | null = null;
  protected appActive = true;
  protected refreshing: Promise<RenewResult> | null = null;
  /** Token push registrado por este celular, para darlo de baja al cerrar sesión. */
  protected pushToken: string | null = null;

  constructor(protected readonly baseUrl: string) {}

  // --- External store ----------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BackendState => this.state;

  protected commit(patch: Partial<BackendState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get currentUser(): User | null {
    const id = this.state.sessionUserId;
    return id ? (this.state.users[id] ?? null) : null;
  }

  protected requireUser(): User {
    const user = this.currentUser;
    if (!user) throw new BackendError("not_allowed");
    return user;
  }

  // --- HTTP ----------------------------------------------------------------------------

  protected async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
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
  protected renew(): Promise<RenewResult> {
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

  protected async saveTokens(tokens: Tokens) {
    this.tokens = tokens;
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens)).catch(() => {});
  }

  protected async clearSession() {
    this.tokens = null;
    this.socket?.close();
    this.socket = null;
    await SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => {});
    await writeJSON(ME_KEY, null);
    // Sin sesión no se sigue enviando la ubicación.
    await stopAlertLocation();
    this.state = emptyState();
    this.listeners.forEach((l) => l());
  }

  protected async upload(uri: string, purpose: "pet" | "owned" | "chat" | "story" | "avatar" | "adoption"): Promise<string> {
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
  protected async uploadFile(fileUri: string, purpose: string, retry = true): Promise<{ id: string; url: string }> {
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

  protected toUser(u: ApiUser | Omit<ApiUser, "email">): User {
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
      lang: u.lang,
      founder: u.founder,
      shelterName: u.shelterName ?? u.shelter,
      shelterStatus: u.shelterStatus ?? (u.shelter ? "verified" : undefined),
    };
  }

  /** Lo público de otras cuentas: nunca correo ni celular (la API no los envía). */
  protected mergeSummaries(list: (ApiSummary | undefined)[]): Record<string, User> {
    const users = { ...this.state.users };
    for (const s of list) {
      if (!s || s.id === this.state.sessionUserId) continue;
      const known = users[s.id];
      users[s.id] = known
        ? {
            ...known,
            avatar: s.avatar,
            photoUrl: s.photoUrl,
            verified: s.verified,
            shelterName: s.shelter ?? (known.shelterStatus === "verified" ? undefined : known.shelterName),
            shelterStatus: s.shelter ? "verified" : known.shelterStatus === "verified" ? undefined : known.shelterStatus,
          }
        : {
            id: s.id,
            name: s.shortName,
            username: "",
            email: "",
            verified: s.verified,
            avatar: s.avatar,
            photoUrl: s.photoUrl,
            title: "animal_lover",
            ...(s.shelter ? { shelterName: s.shelter, shelterStatus: "verified" as const } : {}),
            bio: "",
            city: "",
            createdAt: s.createdAt,
            lang: s.lang,
          };
    }
    return users;
  }

  protected toPet(p: ApiPet): PetCase {
    const { owner: _owner, ...rest } = p;
    return { ...rest, sightings: p.sightings.map((s) => ({ ...s, authorId: s.authorId ?? "" })) };
  }

  protected toMessage(m: ApiMessage): Message {
    const { photo, ...rest } = m;
    return { ...rest, ...(photo ? { photo: { uri: photo.url, width: photo.width, height: photo.height } } : {}) };
  }

  protected mergePets(list: ApiPet[], fromList = false) {
    const byId = new Map(this.state.pets.map((p) => [p.id, p]));
    for (const p of list) {
      const pet = this.toPet(p);
      const known = byId.get(p.id);
      byId.set(p.id, fromList && known?.contactPhone ? { ...pet, contactPhone: known.contactPhone } : pet);
    }
    this.commit({ pets: [...byId.values()], users: this.mergeSummaries(list.map((p) => p.owner)) });
  }

  protected mergeMessages(list: ApiMessage[]) {
    const byId = new Map(this.state.messages.map((m) => [m.id, m]));
    for (const m of list) byId.set(m.id, this.toMessage(m));
    this.commit({ messages: [...byId.values()] });
  }

  protected applyMe(me: ApiMe) {
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

  protected async startSession(session: ApiSession) {
    await this.saveTokens({ access: session.accessToken, refresh: session.refreshToken });
    this.applyMe(session.me);
    void this.sync();
  }

  /** Lo que la app necesita al entrar: bandeja, chats, mis reportes, mis mascotas. */
  protected async sync() {
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

  protected applyThreads(list: ApiThread[]) {
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
  protected connectRealtime() {
    if (this.socket || !this.tokens || !this.appActive || typeof WebSocket === "undefined") return;
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
        if (data.type === "online") this.commit({ onlineCount: data.data as number });
        if (data.type === "follow") void this.loadNetwork().catch(() => {});
        if (data.type === "adoption") this.commit({ adoptionVersion: this.state.adoptionVersion + 1 });
        if (data.type === "pet") {
          const pet = data.data as ApiPet;
          if (!this.getPet(pet.id)) this.mergePets([pet]);
        }
        if (data.type === "pet_closed") {
          const closed = data.data as { id: string; removed: boolean; archived?: boolean; at: string };
          this.closePetLocally(closed.id, closed.removed, closed.at, closed.archived);
        }
      } catch {
        // Evento desconocido: se ignora.
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
    };
  }

  // --- Definidos en las clases de más abajo -------------------------------------

  abstract getPet(petId: string): PetCase | undefined;
  protected abstract closePetLocally(petId: string, removed: boolean, at: string, archived?: boolean): void;
  protected abstract loadOnline(): Promise<void>;
  abstract loadNearby(center: LatLng): Promise<void>;
  abstract loadPet(petId: string): Promise<void>;
  abstract loadThread(threadId: string): Promise<void>;
  abstract loadNetwork(): Promise<void>;
}
