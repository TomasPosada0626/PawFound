import { type AdoptionUpdate } from "@/domain/adoption";

import type {
  AppNotification,
  Message,
  MessageKind,
  NotificationKind,
  NotificationPrefs,
  PrivacyPrefs,
  User,
} from "@/domain/types";
import { shortName } from "@/domain/privacy";

import { type BackendState } from "../backendTypes";

import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_PRIVACY_PREFS,
  type Listener,
  type Translator,
  type BackendOptions,
} from "./constants";

/** Estado en memoria, suscripción de la interfaz y utilidades que usan todas las secciones del modo demostración. */
export abstract class MockBase {
  protected state: BackendState;
  protected listeners = new Set<Listener>();
  protected credentials: Map<string, { userId: string; password: string }>;
  protected readonly now: () => Date;
  protected readonly translator?: Translator;
  protected seq = 0;
  /** Novedades de las adopciones (en la demostración viven solo en memoria). */
  protected adoptionUpdates: AdoptionUpdate[] = [];

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

  protected commit(patch: Partial<BackendState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  protected id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.now().getTime().toString(36)}${this.seq}`;
  }

  protected iso() {
    return this.now().toISOString();
  }

  // --- Compartido entre secciones ---------------------------------------------

  protected makeMessage(threadId: string, kind: MessageKind, author: User, text: string): Message {
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

  protected makeNotification(userId: string, kind: NotificationKind, petId: string): AppNotification {
    return { id: this.id("n"), userId, kind, petId, at: this.iso(), read: false };
  }

  /**
   * Mensajes con las ubicaciones de personas (actual y punto de encuentro) que cumplen el
   * filtro ya ocultas: se borra el punto y queda "ya no visible". Las veterinarias siguen
   * visibles porque son lugares públicos.
   */
  protected hideLocations(match: (m: Message) => boolean): Message[] {
    return this.state.messages.map((m) =>
      m.location && m.location.kind !== "place" && !m.location.hidden && match(m) ? this.withoutLocation(m) : m,
    );
  }

  protected withoutLocation(m: Message): Message {
    if (!m.location) return m;
    const { location: _point, ...rest } = m.location;
    return { ...m, location: { ...rest, hidden: true } };
  }

  notificationPrefsFor(userId: string): NotificationPrefs {
    return this.state.notificationPrefs[userId] ?? DEFAULT_NOTIFICATION_PREFS;
  }

  privacyPrefsFor(userId: string): PrivacyPrefs {
    return this.state.privacyPrefs[userId] ?? DEFAULT_PRIVACY_PREFS;
  }
}
