import type { Lang, LocationShare, Message, MessageLocation, MessagePhoto, Thread } from "@/domain/types";

import { BackendError } from "../backendTypes";

import { MockCases } from "./cases";
import { MESSAGE_MAX, LOCATION_LABEL_MAX, MESSAGES_PER_MINUTE, DEFAULT_PRIVACY_PREFS } from "./constants";

/** Modo demostración: grupos de caso, mensajes directos, fotos y ubicación en el chat. */
export abstract class MockChats extends MockCases {
  // --- Mensajería ----------------------------------------------------------

  async joinGroup(petId: string): Promise<string> {
    const user = this.requireVerified();
    const pet = this.requirePet(petId);
    const thread = this.state.threads.find((t) => t.id === pet.groupId);
    if (!thread) throw new BackendError("not_found");
    if (thread.memberIds.includes(user.id)) return thread.id;
    // Un caso cerrado no suma gente nueva.
    if (thread.archived || pet.state !== "active") throw new BackendError("not_allowed");
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
    if (pet.state !== "active") throw new BackendError("not_allowed");
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

  /** Cierra un mensaje directo para las dos personas. Los grupos se cierran solos con el caso. */
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
  protected assertMessageRate(userId: string) {
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
}
