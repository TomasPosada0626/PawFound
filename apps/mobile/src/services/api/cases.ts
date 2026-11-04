import type { ImpactStats, PublishAllowance } from "@/domain/rules";
import type { AlertZone, LatLng, OwnedPet, PetCase, StoryItem, User } from "@/domain/types";

import { BackendError, type NewReportInput, type NewSightingInput, type OwnedPetInput } from "../backendTypes";

import type { HelperCandidate, HelperReason } from "../selectors";
import { ME_KEY } from "../sessionKeys";
import { readJSON, writeJSON } from "../storage";

import { ApiAccount } from "./account";
import { type ApiSummary, type ApiMe, type ApiPet } from "./shared";

/** Cliente de la API: reportes, avistamientos, cierres, historias, Mis mascotas y ubicación para las alertas. */
export abstract class ApiCases extends ApiAccount {
  // --- Reportes --------------------------------------------------------------------------

  publishAllowanceFor(_userId: string): PublishAllowance {
    // Vencida la espera ya se puede publicar, aunque no se haya vuelto a consultar a la API.
    if (!this.allowance.allowed && this.allowance.retryAt.getTime() <= Date.now()) return { allowed: true };
    return this.allowance;
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
    // Por si se cortó la conexión en vivo, y para quien explora sin cuenta (no la tiene).
    if (this.nearbyCenter) void this.loadNearby(this.nearbyCenter).catch(() => {});
    void this.loadOnline();
    return 0;
  }

  /** Cuántas personas tienen la app abierta. Sin conexión en vivo se consulta en cada ronda. */
  // --- Casos: impacto, avistamientos, cierres, historias y moderación ------------

  /** "Nuestro impacto" de una ciudad, con todos sus casos; null si todavía hay muy pocos. */
  async loadImpact(city: string): Promise<ImpactStats | null> {
    const impact = await this.request<ImpactStats & { enough: boolean }>("GET", `/v1/impact?city=${encodeURIComponent(city)}`);
    if (!impact.enough) return null;
    const { enough: _enough, ...stats } = impact;
    return stats;
  }

  protected async loadOnline() {
    try {
      const { count } = await this.request<{ count: number }>("GET", "/v1/online");
      this.commit({ onlineCount: count });
    } catch {
      // Sin red: se reintenta en la próxima ronda.
    }
  }

  /** Solo cuenta como conectada quien tiene la app abierta: al salir se cierra la conexión en vivo. */
  setAppActive(active: boolean): void {
    this.appActive = active;
    if (active) {
      this.connectRealtime();
      return;
    }
    this.socket?.close();
    this.socket = null;
  }

  /** Aplica el cierre de un caso en este celular, sin esperar a la próxima sincronización. */
  /** Un caso que se cerró en otro lado: reencuentro, retirado (removed) o archivado por falta de novedades. */
  protected closePetLocally(petId: string, removed: boolean, at: string, archived = false) {
    const pet = this.getPet(petId);
    if (!pet) return;
    this.commit({
      pets: removed
        ? this.state.pets.filter((p) => p.id !== petId)
        : this.state.pets.map((p) =>
            p.id !== petId
              ? p
              : archived
                ? { ...p, state: "archived" as const }
                : { ...p, state: "reunited" as const, reunitedAt: p.reunitedAt ?? at },
          ),
      threads: this.state.threads.map((t) =>
        t.id === pet.groupId || (t.kind === "dm" && t.petId === petId) ? { ...t, archived: true } : t,
      ),
      stories: this.state.stories.filter((s) => s.petId !== petId),
      notifications: removed ? this.state.notifications.filter((n) => n.petId !== petId) : this.state.notifications,
    });
  }

  /** Elimina la publicación: deja de verse para todas las personas y su grupo se cierra. */
  async withdrawPet(petId: string): Promise<void> {
    await this.request("DELETE", `/v1/pets/${petId}`);
    this.closePetLocally(petId, true, new Date().toISOString());
  }

  async helperCandidates(petId: string): Promise<HelperCandidate[]> {
    const list = await this.request<{ userId: string; user: ApiSummary; reasons: HelperReason[] }[]>(
      "GET",
      `/v1/pets/${petId}/helpers`,
    );
    const users = this.mergeSummaries(list.map((c) => c.user));
    this.commit({ users });
    return list.map((c) => ({ userId: c.userId, user: users[c.userId] as User, reasons: c.reasons }));
  }

  async addSighting(petId: string, input: NewSightingInput): Promise<void> {
    this.mergePets([await this.request<ApiPet>("POST", `/v1/pets/${petId}/sightings`, input)]);
  }

  async markReunited(petId: string, helperIds: string[] = [], ratings: Record<string, number> = {}): Promise<void> {
    this.mergePets([await this.request<ApiPet>("POST", `/v1/pets/${petId}/reunite`, { helperIds, ratings })]);
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

  /** Muestra (o quita con "") el celular de la familia en el afiche del caso. */
  async setContactPhone(petId: string, phone: string): Promise<void> {
    this.mergePets([await this.request<ApiPet>("PUT", `/v1/pets/${petId}/contact`, { phone })]);
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
    // La tarea en segundo plano la lee de aquí: corre sin la app abierta.
    const cached = await readJSON<ApiMe>(ME_KEY);
    if (cached) await writeJSON(ME_KEY, { ...cached, alertZone: alertZones[user.id] ?? null });
  }

  async updateAlertLocation(point: LatLng, zoneName?: string): Promise<void> {
    const user = this.currentUser;
    const current = user ? this.state.alertZones[user.id] : undefined;
    if (!user || !current) return;
    await this.setAlertZone({ location: point, zone: zoneName ?? current.zone }).catch(() => {});
  }
}
