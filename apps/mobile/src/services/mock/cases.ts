import { alertAudience, type AlertCandidate } from "@/domain/alerts";

import { approximateLocation } from "@/domain/geo";
import { matchOwned } from "@/domain/matching";
import { findPossibleMatches, publishAllowance } from "@/domain/rules";
import type { AlertZone, LatLng, AppNotification, OwnedPet, PetCase, StoryItem, Thread } from "@/domain/types";
import { shortName } from "@/domain/privacy";
import { normalizeColombianMobile } from "@/domain/validation";

import { reunionHelperCandidates, type HelperCandidate } from "../selectors";

import { BackendError, type NewReportInput, type NewSightingInput, type OwnedPetInput } from "../backendTypes";

import { MockAccounts } from "./accounts";
import { MAX_HELPERS, MAX_OWNED_PETS, ALERT_KINDS } from "./constants";

/** Modo demostración: reportes, avistamientos, cierres, Mis mascotas y zona de alertas. */
export abstract class MockCases extends MockAccounts {
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
  protected ownedMatchNotifications(found: PetCase): AppNotification[] {
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

  protected requirePet(petId: string): PetCase {
    const pet = this.getPet(petId);
    if (!pet) throw new BackendError("not_found");
    return pet;
  }

  protected replacePet(pet: PetCase) {
    return this.state.pets.map((p) => (p.id === pet.id ? pet : p));
  }

  /** Cuentas con zona de alertas, con lo necesario para decidir si se les avisa de este caso. */
  protected alertCandidates(pet: PetCase): AlertCandidate[] {
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
  async markReunited(petId: string, helperIds: string[] = [], ratings: Record<string, number> = {}): Promise<void> {
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
    const ratingStars = { ...this.state.ratingStars };
    for (const id of helpers) {
      const stars = ratings[id];
      if (stars) ratingStars[id] = [stars, ...(ratingStars[id] ?? [])];
    }
    this.commit({
      ratingStars,
      pets: this.replacePet({
        ...pet,
        state: "reunited",
        contactPhone: undefined,
        reunitedAt: this.iso(),
        ...(helpers.length ? { helperIds: helpers } : {}),
      }),
      // El grupo y los mensajes directos del caso se cierran solos: quedan para leer.
      threads: this.state.threads.map((t) =>
        t.id === pet.groupId || (t.kind === "dm" && t.petId === petId) ? { ...t, archived: true } : t,
      ),
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

  /** Elimina la publicación: deja de verse para todas las personas y sus chats se cierran. */
  async withdrawPet(petId: string): Promise<void> {
    const user = this.requireUser();
    const pet = this.requirePet(petId);
    if (pet.ownerId !== user.id) throw new BackendError("not_allowed");
    this.commit({
      pets: this.state.pets.filter((p) => p.id !== petId),
      threads: this.state.threads.map((t) =>
        t.id === pet.groupId || (t.kind === "dm" && t.petId === petId) ? { ...t, archived: true } : t,
      ),
      stories: this.state.stories.filter((s) => s.petId !== petId),
      notifications: this.state.notifications.filter((n) => n.petId !== petId),
      messages: this.hideLocations((m) =>
        this.state.threads.some((t) => t.id === m.threadId && t.kind === "dm" && t.petId === petId),
      ),
    });
  }

  async helperCandidates(petId: string): Promise<HelperCandidate[]> {
    return reunionHelperCandidates(this.state, petId);
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

  /** En la demostración no hay conexión en vivo. */
  setAppActive(_active: boolean): void {}

  /** Muestra (o quita con "") el celular de la familia en el afiche del caso. */
  async setContactPhone(petId: string, phone: string): Promise<void> {
    const user = this.requireVerified();
    const pet = this.requirePet(petId);
    if (pet.ownerId !== user.id || pet.state !== "active") throw new BackendError("not_allowed");
    const normalized = phone.trim() ? normalizeColombianMobile(phone) : undefined;
    if (normalized === null) throw new BackendError("invalid_phone");
    const { contactPhone: _old, ...rest } = pet;
    this.commit({ pets: this.replacePet(normalized ? { ...rest, contactPhone: normalized } : rest) });
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
}
