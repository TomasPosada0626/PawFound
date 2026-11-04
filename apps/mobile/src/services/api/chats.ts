import type { Lang, LocationShare, MessagePhoto } from "@/domain/types";

import { ApiPawFamily } from "./pawfamily";
import { type ApiMessage } from "./shared";

/** Cliente de la API: grupos de caso, mensajes directos, fotos y ubicación en el chat. */
export abstract class ApiChats extends ApiPawFamily {
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
}
