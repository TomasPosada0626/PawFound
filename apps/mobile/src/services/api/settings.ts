import type { Lang, NotificationPrefs, PrivacyPrefs, UserReportReason } from "@/domain/types";

import { BackendError, type ProfilePatch } from "../backendTypes";
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_PRIVACY_PREFS } from "../mockBackend";

import { ApiChats } from "./chats";
import { type ApiMe } from "./shared";

/** Cliente de la API: perfil, preferencias, privacidad y eliminar la cuenta. */
export abstract class ApiSettings extends ApiChats {
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
  protected setLikes(userId: string, likes: number, likedByMe: boolean) {
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
}
