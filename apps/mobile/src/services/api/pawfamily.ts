import type { AdoptionFilters, AdoptionInput, AdoptionReportReason, ApplicationInput, AdoptionUpdate } from "@/domain/adoption";

import type { ShelterResult } from "@/domain/shelter";

import type { LatLng } from "@/domain/types";

import { ApiCases } from "./cases";
import { type ApiAdoption, type ApiApplication } from "./shared";

/** Cliente de la API: PawFamily (adopciones, solicitudes, seguimiento y refugios). */
export abstract class ApiPawFamily extends ApiCases {
  // --- PawFamily -----------------------------------------------------------------------

  protected mergeAdoptions(list: ApiAdoption[]) {
    if (!list.length) return;
    const users = this.mergeSummaries(list.map((a) => a.owner));
    const byId = new Map(this.state.adoptions.map((a) => [a.id, a]));
    for (const { owner, ...rest } of list) byId.set(rest.id, { ...rest, ownerId: owner.id });
    this.commit({ users, adoptions: [...byId.values()] });
  }

  protected mergeApplications(list: ApiApplication[]) {
    this.mergeAdoptions(list.flatMap((a) => (a.adoption ? [a.adoption] : [])));
    const users = this.mergeSummaries(list.map((a) => a.applicant));
    const byId = new Map(this.state.adoptionApplications.map((a) => [a.id, a]));
    for (const { applicant, adoption: _adoption, ...rest } of list) byId.set(rest.id, { ...rest, applicantId: applicant.id });
    this.commit({ users, adoptionApplications: [...byId.values()] });
  }

  /** Lista cerca de un punto (o en una ciudad). Devuelve los ids en orden de cercanía. */
  async loadAdoptions(center: LatLng, filters: AdoptionFilters): Promise<string[]> {
    const params = new URLSearchParams({
      lat: String(center.latitude),
      lng: String(center.longitude),
      radius: String(filters.radiusKm * 1000),
    });
    for (const key of ["city", "species", "sex", "size", "age"] as const) {
      const value = filters[key];
      if (value) params.set(key, value);
    }
    const list = await this.request<ApiAdoption[]>("GET", `/v1/adoptions?${params.toString()}`);
    this.mergeAdoptions(list);
    return list.map((a) => a.id);
  }

  async loadAdoption(id: string): Promise<void> {
    this.mergeAdoptions([await this.request<ApiAdoption>("GET", `/v1/adoptions/${id}`)]);
  }

  /**
   * Verifica la cuenta como refugio: la API revisa el NIT en el RUES. Queda verificada al instante o
   * en revisión, según lo que encuentre.
   */
  async verifyShelter(name: string, nit: string): Promise<ShelterResult> {
    const result = await this.request<ShelterResult>("POST", "/v1/me/shelter", { name, nit });
    const me = this.state.sessionUserId;
    const user = me ? this.state.users[me] : undefined;
    if (user) {
      this.commit({
        users: { ...this.state.users, [user.id]: { ...user, shelterName: name.trim(), shelterStatus: result.status } },
      });
    }
    return result;
  }

  async acceptAdoptionTerms(): Promise<void> {
    await this.request("POST", "/v1/me/adoption-terms");
  }

  async createAdoption(input: AdoptionInput): Promise<string> {
    const photos: string[] = [];
    for (const uri of input.photos) photos.push(await this.upload(uri, "adoption"));
    const created = await this.request<ApiAdoption>("POST", "/v1/adoptions", { ...input, photos });
    this.mergeAdoptions([created]);
    return created.id;
  }

  /** Lo que una cuenta tiene hoy en adopción (perfil público de un refugio). */
  async loadUserAdoptions(userId: string): Promise<string[]> {
    const list = await this.request<ApiAdoption[]>("GET", `/v1/users/${userId}/adoptions`);
    this.mergeAdoptions(list);
    return list.map((a) => a.id);
  }

  /** Novedades de la nueva familia: las ven quien dio en adopción y quien adoptó. */
  async loadAdoptionUpdates(adoptionId: string): Promise<AdoptionUpdate[]> {
    return this.request<AdoptionUpdate[]>("GET", `/v1/adoptions/${adoptionId}/updates`);
  }

  /** Quien adoptó cuenta cómo está la mascota: una foto, unas palabras o las dos. */
  async addAdoptionUpdate(adoptionId: string, input: { photo?: string; body: string }): Promise<AdoptionUpdate> {
    const photo = input.photo ? await this.upload(input.photo, "adoption") : undefined;
    return this.request<AdoptionUpdate>("POST", `/v1/adoptions/${adoptionId}/updates`, { photo, body: input.body });
  }

  async loadMyAdoptions(): Promise<string[]> {
    const list = await this.request<ApiAdoption[]>("GET", "/v1/me/adoptions");
    this.mergeAdoptions(list);
    return list.map((a) => a.id);
  }

  async loadAdoptionApplications(adoptionId: string): Promise<void> {
    this.mergeApplications(await this.request<ApiApplication[]>("GET", `/v1/adoptions/${adoptionId}/applications`));
  }

  async applyToAdoption(adoptionId: string, input: ApplicationInput): Promise<void> {
    this.mergeApplications([await this.request<ApiApplication>("POST", `/v1/adoptions/${adoptionId}/apply`, input)]);
    await this.loadAdoption(adoptionId);
  }

  async loadMyApplications(): Promise<void> {
    this.mergeApplications(await this.request<ApiApplication[]>("GET", "/v1/me/adoption-applications"));
  }

  /** Acepta una solicitud y devuelve el chat que se abre con esa persona. */
  async acceptApplication(applicationId: string): Promise<string> {
    const { threadId } = await this.request<{ threadId: string }>("POST", `/v1/adoption-applications/${applicationId}/accept`);
    const application = this.state.adoptionApplications.find((a) => a.id === applicationId);
    if (application) {
      await Promise.allSettled([
        this.loadAdoptionApplications(application.adoptionId),
        this.loadAdoption(application.adoptionId),
      ]);
    }
    await this.loadThread(threadId).catch(() => {});
    return threadId;
  }

  async declineApplication(applicationId: string): Promise<void> {
    await this.request("POST", `/v1/adoption-applications/${applicationId}/decline`);
    this.commit({
      adoptionApplications: this.state.adoptionApplications.map((a) =>
        a.id === applicationId ? { ...a, status: "declined" as const } : a,
      ),
    });
  }

  async markAdopted(adoptionId: string): Promise<void> {
    await this.request("POST", `/v1/adoptions/${adoptionId}/adopted`);
    await this.loadAdoption(adoptionId);
  }

  async withdrawAdoption(adoptionId: string): Promise<void> {
    await this.request("DELETE", `/v1/adoptions/${adoptionId}`);
    this.commit({ adoptions: this.state.adoptions.filter((a) => a.id !== adoptionId) });
  }

  async reportAdoption(adoptionId: string, reason: AdoptionReportReason, note?: string): Promise<void> {
    await this.request("POST", `/v1/adoptions/${adoptionId}/report`, { reason, note });
  }
}
