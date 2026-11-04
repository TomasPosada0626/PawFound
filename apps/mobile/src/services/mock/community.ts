import type { LatLng, Lang, NotificationPrefs, PrivacyPrefs, User, UserReport, UserReportReason } from "@/domain/types";

import { normalizeColombianMobile } from "@/domain/validation";

import { BackendError, type FollowEdge, type FollowStatus, type BackendState, type ProfilePatch } from "../backendTypes";

import { MockChats } from "./chats";

/** Modo demostración: perfil, preferencias, me gusta, reportes de personas y red de seguidores. */
export abstract class MockCommunity extends MockChats {
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

  /** Foto de perfil propia; null la quita y vuelve el avatar. */
  async setProfilePhoto(uri: string | null): Promise<void> {
    const user = this.requireVerified();
    this.commit({ users: { ...this.state.users, [user.id]: { ...user, photoUrl: uri ?? undefined } } });
  }

  /** La app informa el idioma elegido para que los chats lleguen traducidos a él. */
  async setLanguage(lang: Lang): Promise<void> {
    const user = this.currentUser;
    if (!user || user.lang === lang) return;
    this.commit({ users: { ...this.state.users, [user.id]: { ...user, lang } } });
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

  /** Lo que la API le daría a esta cuenta: su propia red y solo el número de los demás. */
  protected networkSnapshot(follows = this.state.follows): Pick<BackendState, "follows" | "network" | "followInfo"> {
    const me = this.state.sessionUserId;
    const ids = (status: FollowEdge["status"], incoming: boolean) =>
      follows
        .filter((f) => f.status === status && (incoming ? f.followedId === me : f.followerId === me))
        .map((f) => (incoming ? f.followerId : f.followedId));
    const count = (userId: string, incoming: boolean) =>
      follows.filter((f) => f.status === "accepted" && (incoming ? f.followedId === userId : f.followerId === userId)).length;
    const statusOf = (userId: string): FollowStatus => {
      const edge = follows.find((f) => f.followerId === me && f.followedId === userId);
      return edge && edge.status !== "declined" ? edge.status : "none";
    };
    return {
      follows,
      network: {
        requests: ids("pending", true),
        followers: ids("accepted", true),
        following: ids("accepted", false),
        sent: ids("pending", false),
      },
      followInfo: Object.fromEntries(
        Object.keys(this.state.users).map((id) => [
          id,
          {
            followers: count(id, true),
            following: count(id, false),
            status: statusOf(id),
          },
        ]),
      ),
    };
  }

  /** Quita un solo sentido: la otra persona sigue siguiendo. Los "me gusta" se conservan. */
  protected withoutEdge(followerId: string, followedId: string, follows = this.state.follows): FollowEdge[] {
    return follows.filter((f) => !(f.followerId === followerId && f.followedId === followedId));
  }

  async searchUsers(query: string): Promise<User[]> {
    const me = this.requireUser();
    const q = query.trim().replace(/^@/, "").toLowerCase();
    if (q.length < 3) return [];
    return Object.values(this.state.users)
      .filter((u) => u.id !== me.id && u.username.startsWith(q))
      .slice(0, 20);
  }

  async loadNetwork(): Promise<void> {
    this.commit(this.networkSnapshot());
  }

  async followUser(userId: string): Promise<FollowStatus> {
    const me = this.requireVerified();
    if (userId === me.id || !this.state.users[userId]) throw new BackendError("not_allowed");
    const edge = this.state.follows.find((f) => f.followerId === me.id && f.followedId === userId);
    if (edge && edge.status !== "declined") return edge.status;
    if ((edge?.declines ?? 0) >= 3) throw new BackendError("follow_wait");
    const crossed = this.state.follows.some((f) => f.followerId === userId && f.followedId === me.id && f.status === "pending");
    if (crossed) {
      this.commit(this.networkSnapshot(this.mutualEdges(me.id, userId)));
      return "accepted";
    }
    this.commit(
      this.networkSnapshot([
        ...this.withoutEdge(me.id, userId),
        { followerId: me.id, followedId: userId, status: "pending", declines: edge?.declines ?? 0 },
      ]),
    );
    return "pending";
  }

  /** Las relaciones con las dos cuentas siguiéndose. */
  protected mutualEdges(one: string, other: string): FollowEdge[] {
    return [
      ...this.withoutEdge(other, one, this.withoutEdge(one, other)),
      { followerId: one, followedId: other, status: "accepted" },
      { followerId: other, followedId: one, status: "accepted" },
    ];
  }

  async unfollowUser(userId: string): Promise<void> {
    const me = this.requireUser();
    const edge = this.state.follows.find((f) => f.followerId === me.id && f.followedId === userId);
    if (edge?.status === "accepted") {
      this.commit(this.networkSnapshot(this.withoutEdge(me.id, userId)));
    } else if (edge?.status === "pending") {
      this.commit(this.networkSnapshot(this.state.follows.map((f) => (f === edge ? { ...f, status: "declined" as const } : f))));
    }
  }

  async acceptFollower(userId: string): Promise<void> {
    const me = this.requireUser();
    const pending = this.state.follows.some((f) => f.followerId === userId && f.followedId === me.id && f.status === "pending");
    if (pending) this.commit(this.networkSnapshot(this.mutualEdges(me.id, userId)));
  }

  /** Rechaza una solicitud (al tercer rechazo se suspende el envío) o elimina a un seguidor. */
  async removeFollower(userId: string): Promise<void> {
    const me = this.requireUser();
    const edge = this.state.follows.find((f) => f.followerId === userId && f.followedId === me.id);
    if (edge?.status === "accepted") {
      this.commit(this.networkSnapshot(this.withoutEdge(userId, me.id)));
    } else if (edge?.status === "pending") {
      this.commit(
        this.networkSnapshot(
          this.state.follows.map((f) =>
            f === edge ? { ...f, status: "declined" as const, declines: (f.declines ?? 0) + 1 } : f,
          ),
        ),
      );
    }
  }
}
