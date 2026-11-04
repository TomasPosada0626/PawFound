import {
  applicationProblem,
  isListed,
  type Adoption,
  type AdoptionApplication,
  type AdoptionFilters,
  type AdoptionInput,
  type AdoptionReportReason,
  type ApplicationInput,
  type AdoptionUpdate,
  ADOPTION_UPDATE_MAX,
} from "@/domain/adoption";
import { normalizeNit, type ShelterResult } from "@/domain/shelter";
import { approximateLocation, distanceMeters } from "@/domain/geo";

import { cityFromZone, cityKey, impactStats, type ImpactStats } from "@/domain/rules";
import type { LatLng, Thread, User } from "@/domain/types";

import { BackendError } from "./backendTypes";

import { MockCommunity } from "./mock/community";

export * from "./mock/constants";

/**
 * Backend simulado en memoria para el modo demostración.
 *
 * Aplica las mismas reglas de negocio que la API (límite diario, verificación del correo,
 * ubicación aproximada, permisos), para que la app se comporte igual cuando se conecte
 * al servidor real. Es un "external store": la UI se suscribe con useSyncExternalStore.
 *
 * Las contraseñas de demostración viven en texto plano solo aquí, en memoria y en el
 * dispositivo; la API real usa Argon2id (docs/ARCHITECTURE.md).
 */
export class MockBackend extends MockCommunity {
  // --- PawFamily -------------------------------------------------------------------

  protected requireAdoptionTerms(): User {
    const user = this.requireVerified();
    if (!this.adoptionTermsAccepted.has(user.id)) throw new BackendError("adoption_terms");
    return user;
  }

  protected adoptionTermsAccepted = new Set<string>();

  async loadAdoptions(center: LatLng, filters: AdoptionFilters): Promise<string[]> {
    const city = filters.city ? cityKey(filters.city) : "";
    return this.state.adoptions
      .filter(
        (a) =>
          isListed(a) &&
          (city ? cityKey(cityFromZone(a.zone)) === city : distanceMeters(center, a.location) <= filters.radiusKm * 1000) &&
          (!filters.species || a.species === filters.species) &&
          (!filters.sex || a.sex === filters.sex) &&
          (!filters.size || a.size === filters.size) &&
          (!filters.age || a.age === filters.age),
      )
      .sort(
        (x, y) =>
          Number(x.status === "in_process") - Number(y.status === "in_process") ||
          distanceMeters(center, x.location) - distanceMeters(center, y.location),
      )
      .map((a) => a.id);
  }

  async loadAdoption(id: string): Promise<void> {
    if (!this.state.adoptions.some((a) => a.id === id)) throw new BackendError("not_found");
  }

  /** En la demostración no hay RUES: con el dígito de verificación correcto queda verificado. */
  async verifyShelter(name: string, nit: string): Promise<ShelterResult> {
    const user = this.requireVerified();
    if (!name.trim() || !normalizeNit(nit)) throw new BackendError("invalid_input");
    if (user.shelterStatus === "rejected") throw new BackendError("not_allowed");
    this.commit({ users: { ...this.state.users, [user.id]: { ...user, shelterName: name.trim(), shelterStatus: "verified" } } });
    return { status: "verified" };
  }

  async acceptAdoptionTerms(): Promise<void> {
    this.adoptionTermsAccepted.add(this.requireUser().id);
  }

  async createAdoption(input: AdoptionInput): Promise<string> {
    const user = this.requireAdoptionTerms();
    if (!input.name.trim() || !input.description.trim() || !input.photos.length || !input.zone.trim()) {
      throw new BackendError("invalid_input");
    }
    const adoption: Adoption = {
      ...input,
      id: this.id("ad"),
      ownerId: user.id,
      name: input.name.trim(),
      location: approximateLocation(input.location),
      status: "available",
      createdAt: this.iso(),
    };
    this.commit({ adoptions: [adoption, ...this.state.adoptions] });
    return adoption.id;
  }

  async loadUserAdoptions(userId: string): Promise<string[]> {
    return this.state.adoptions
      .filter((a) => a.ownerId === userId && (a.status === "available" || a.status === "in_process"))
      .map((a) => a.id);
  }

  /** Quien adoptó: la solicitud aceptada de una adopción ya concretada. */
  protected adopterOf(adoptionId: string): string | undefined {
    const adoption = this.state.adoptions.find((a) => a.id === adoptionId);
    if (adoption?.status !== "adopted") return undefined;
    return this.state.adoptionApplications.find((a) => a.adoptionId === adoptionId && a.status === "accepted")?.applicantId;
  }

  async loadAdoptionUpdates(adoptionId: string): Promise<AdoptionUpdate[]> {
    const user = this.requireUser();
    const adoption = this.state.adoptions.find((a) => a.id === adoptionId);
    if (!adoption) throw new BackendError("not_found");
    if (user.id !== adoption.ownerId && user.id !== this.adopterOf(adoptionId)) throw new BackendError("not_allowed");
    return this.adoptionUpdates.filter((u) => u.adoptionId === adoptionId).sort((a, b) => b.at.localeCompare(a.at));
  }

  async addAdoptionUpdate(adoptionId: string, input: { photo?: string; body: string }): Promise<AdoptionUpdate> {
    const user = this.requireVerified();
    if (!this.state.adoptions.some((a) => a.id === adoptionId)) throw new BackendError("not_found");
    if (user.id !== this.adopterOf(adoptionId)) throw new BackendError("not_allowed");
    const body = input.body.trim().slice(0, ADOPTION_UPDATE_MAX);
    if (!body && !input.photo) throw new BackendError("invalid_input");
    const update: AdoptionUpdate = {
      id: this.id("upd"),
      adoptionId,
      authorId: user.id,
      photo: input.photo,
      body,
      at: this.iso(),
    };
    this.adoptionUpdates = [update, ...this.adoptionUpdates];
    return update;
  }

  async loadMyAdoptions(): Promise<string[]> {
    const user = this.requireUser();
    return this.state.adoptions.filter((a) => a.ownerId === user.id && a.status !== "withdrawn").map((a) => a.id);
  }

  async loadAdoptionApplications(adoptionId: string): Promise<void> {
    const user = this.requireUser();
    const adoption = this.state.adoptions.find((a) => a.id === adoptionId);
    if (!adoption) throw new BackendError("not_found");
    if (adoption.ownerId !== user.id) throw new BackendError("not_allowed");
  }

  async applyToAdoption(adoptionId: string, input: ApplicationInput): Promise<void> {
    const user = this.requireAdoptionTerms();
    const adoption = this.state.adoptions.find((a) => a.id === adoptionId);
    if (!adoption) throw new BackendError("not_found");
    if (adoption.ownerId === user.id || !isListed(adoption)) throw new BackendError("not_allowed");
    if (applicationProblem(input)) throw new BackendError("invalid_input");
    if (this.state.adoptionApplications.some((a) => a.adoptionId === adoptionId && a.applicantId === user.id)) {
      throw new BackendError("already_applied");
    }
    const application: AdoptionApplication = {
      ...input,
      id: this.id("ap"),
      adoptionId,
      applicantId: user.id,
      status: "pending",
      createdAt: this.iso(),
    };
    this.commit({ adoptionApplications: [application, ...this.state.adoptionApplications] });
  }

  async loadMyApplications(): Promise<void> {
    this.requireUser();
  }

  protected decidable(applicationId: string) {
    const user = this.requireUser();
    const application = this.state.adoptionApplications.find((a) => a.id === applicationId);
    const adoption = application && this.state.adoptions.find((a) => a.id === application.adoptionId);
    if (!application || !adoption) throw new BackendError("not_found");
    if (adoption.ownerId !== user.id || application.status !== "pending" || !isListed(adoption))
      throw new BackendError("not_allowed");
    return { user, application, adoption };
  }

  async acceptApplication(applicationId: string): Promise<string> {
    const { user, application, adoption } = this.decidable(applicationId);
    const existing = this.state.threads.find(
      (t) => t.kind === "dm" && !t.archived && t.memberIds.includes(user.id) && t.memberIds.includes(application.applicantId),
    );
    const thread: Thread = existing ?? {
      id: this.id("dm"),
      kind: "dm",
      memberIds: [user.id, application.applicantId],
      readAt: { [user.id]: this.iso() },
      mutedBy: [],
      archived: false,
      archivedBy: [],
    };
    this.commit({
      threads: existing ? this.state.threads : [thread, ...this.state.threads],
      messages: [...this.state.messages, this.makeMessage(thread.id, "system", user, "adoption_accepted")],
      adoptionApplications: this.state.adoptionApplications.map((a) =>
        a.id === applicationId ? { ...a, status: "accepted" as const, threadId: thread.id } : a,
      ),
      adoptions: this.state.adoptions.map((a) =>
        a.id === adoption.id && a.status === "available" ? { ...a, status: "in_process" as const } : a,
      ),
    });
    return thread.id;
  }

  async declineApplication(applicationId: string): Promise<void> {
    this.decidable(applicationId);
    this.commit({
      adoptionApplications: this.state.adoptionApplications.map((a) =>
        a.id === applicationId ? { ...a, status: "declined" as const } : a,
      ),
    });
  }

  protected closeAdoption(adoptionId: string, status: "adopted" | "withdrawn") {
    const user = this.requireUser();
    const adoption = this.state.adoptions.find((a) => a.id === adoptionId);
    if (!adoption) throw new BackendError("not_found");
    if (adoption.ownerId !== user.id || !isListed(adoption)) throw new BackendError("not_allowed");
    this.commit({
      adoptions: this.state.adoptions.map((a) =>
        a.id === adoptionId ? { ...a, status, adoptedAt: status === "adopted" ? this.iso() : undefined } : a,
      ),
      adoptionApplications: this.state.adoptionApplications.map((a) =>
        a.adoptionId === adoptionId && a.status === "pending" ? { ...a, status: "declined" as const } : a,
      ),
    });
  }

  async markAdopted(adoptionId: string): Promise<void> {
    this.closeAdoption(adoptionId, "adopted");
  }

  async withdrawAdoption(adoptionId: string): Promise<void> {
    this.closeAdoption(adoptionId, "withdrawn");
  }

  async reportAdoption(adoptionId: string, _reason: AdoptionReportReason, _note?: string): Promise<void> {
    const user = this.requireUser();
    const adoption = this.state.adoptions.find((a) => a.id === adoptionId);
    if (!adoption) throw new BackendError("not_found");
    if (adoption.ownerId === user.id) throw new BackendError("not_allowed");
  }

  /** En demostración las cifras salen de los casos cargados de esa ciudad. */
  async loadImpact(city: string): Promise<ImpactStats | null> {
    const key = cityKey(city);
    return impactStats(
      this.state.pets.filter((p) => cityKey(cityFromZone(p.zone)) === key),
      this.now(),
    );
  }

  async loadProfile(_userId: string): Promise<void> {
    this.commit(this.networkSnapshot());
  }

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

  /**
   * Derecho al olvido, como la API: borra la cuenta y todo lo que publicó (reportes con su grupo,
   * PawFamily, avistamientos, mensajes, chats directos, red y me gusta). En los grupos ajenos solo
   * quedan los avisos del sistema, sin su nombre.
   */
  async deleteAccount(): Promise<void> {
    const user = this.requireUser();
    const me = user.id;
    for (const [email, entry] of this.credentials) if (entry.userId === me) this.credentials.delete(email);
    const without = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => id !== me));
    const removedPets = new Set(this.state.pets.filter((p) => p.ownerId === me).map((p) => p.id));
    const removedAdoptions = new Set(this.state.adoptions.filter((a) => a.ownerId === me).map((a) => a.id));
    const removedThreads = new Set(
      this.state.threads
        .filter((t) => (t.kind === "dm" && t.memberIds.includes(me)) || (t.petId !== undefined && removedPets.has(t.petId)))
        .map((t) => t.id),
    );
    this.commit({
      follows: this.state.follows.filter((f) => f.followerId !== me && f.followedId !== me),
      profileLikes: Object.fromEntries(
        Object.entries(without(this.state.profileLikes)).map(([target, likers]) => [target, likers.filter((id) => id !== me)]),
      ),
      ratingStars: without(this.state.ratingStars),
      alertZones: without(this.state.alertZones),
      shareLog: without(this.state.shareLog),
      reportLog: without(this.state.reportLog),
      notificationPrefs: without(this.state.notificationPrefs),
      privacyPrefs: without(this.state.privacyPrefs),
      ownedPets: this.state.ownedPets.filter((p) => p.ownerId !== me),
      users: without(this.state.users),
      sessionUserId: null,
      verification: null,
      network: { requests: [], followers: [], following: [], sent: [] },
      pets: this.state.pets
        .filter((p) => !removedPets.has(p.id))
        .map((p) => ({
          ...p,
          sightings: p.sightings.filter((s) => s.authorId !== me),
          helperIds: p.helperIds?.filter((id) => id !== me),
        })),
      stories: this.state.stories.filter((s) => s.authorId !== me && !removedPets.has(s.petId)),
      adoptions: this.state.adoptions.filter((a) => !removedAdoptions.has(a.id)),
      adoptionApplications: this.state.adoptionApplications.filter(
        (a) => a.applicantId !== me && !removedAdoptions.has(a.adoptionId),
      ),
      userReports: this.state.userReports.filter((r) => r.reportedId !== me),
      threads: this.state.threads
        .filter((t) => !removedThreads.has(t.id))
        .map((t) => ({ ...t, memberIds: t.memberIds.filter((id) => id !== me) })),
      messages: this.state.messages
        .filter((m) => !removedThreads.has(m.threadId) && (m.authorId !== me || m.kind === "system"))
        .map((m) => (m.authorId === me ? { ...m, authorId: "deleted", authorShortName: "" } : m)),
      notifications: this.state.notifications.filter((n) => n.userId !== me && !removedPets.has(n.petId)),
    });
  }
}
