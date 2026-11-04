import { approximateLocation, distanceMeters } from "@/domain/geo";

import type { LatLng, PetCase, Place, StoryItem, User } from "@/domain/types";

import { BackendError, type FollowStatus } from "./backendTypes";

import { ApiSettings } from "./api/settings";
import {
  NEARBY_RADIUS,
  NEARBY_LIMIT,
  type ApiPet,
  type ApiMessage,
  type ApiThread,
  type ApiStory,
  type ApiPerson,
  type ApiNetwork,
  type ApiProfile,
} from "./api/shared";

/**
 * Backend real: la misma interfaz que MockBackend, sobre la API de PawFound
 * (packages/contracts/openapi.yaml). Mantiene una copia local del estado que las pantallas ya
 * saben leer, la completa con la API (al entrar, con los cargadores load* y en vivo por
 * WebSocket) y la actualiza después de cada acción. Los tokens viven en SecureStore; el de
 * acceso se renueva solo con el refresh token. Cada parte vive en src/services/api/: esta clase
 * suma los cargadores sobre la cadena ApiBase → ApiAccount → ApiCases → ApiPawFamily → ApiChats
 * → ApiSettings.
 */
export class ApiBackend extends ApiSettings {
  // --- Cargadores: completan la copia local cuando una pantalla los necesita -----------------

  async loadNearby(center: LatLng): Promise<void> {
    this.nearbyCenter = center;
    try {
      const list = await this.request<ApiPet[]>(
        "GET",
        `/v1/pets?lat=${center.latitude}&lng=${center.longitude}&radius=${NEARBY_RADIUS}`,
      );
      this.mergePets(list, true);
      if (list.length < NEARBY_LIMIT) {
        // Lo que ya no viene de la zona dejó de estar activo: no se puede seguir mostrando.
        const current = new Set(list.map((p) => p.id));
        const stale = (p: PetCase) =>
          p.state === "active" &&
          p.ownerId !== this.state.sessionUserId &&
          !current.has(p.id) &&
          distanceMeters(center, p.location) <= NEARBY_RADIUS;
        if (this.state.pets.some(stale)) this.commit({ pets: this.state.pets.filter((p) => !stale(p)) });
      }
    } finally {
      // Con o sin éxito termina la espera: sin red se muestra el estado vacío, no esqueletos eternos.
      if (!this.state.nearbyLoaded) this.commit({ nearbyLoaded: true });
    }
  }

  async loadPet(petId: string): Promise<void> {
    try {
      this.mergePets([await this.request<ApiPet>("GET", `/v1/pets/${petId}`)]);
    } catch (e) {
      if (!(e instanceof BackendError && e.code === "not_found")) throw e;
    }
  }

  async loadThread(threadId: string): Promise<void> {
    const [thread, messages] = await Promise.all([
      this.request<ApiThread>("GET", `/v1/threads/${threadId}`),
      this.request<ApiMessage[]>("GET", `/v1/threads/${threadId}/messages`),
    ]);
    this.applyThreads([thread]);
    this.mergeMessages(messages);
    if (thread.petId && !this.getPet(thread.petId)) await this.loadPet(thread.petId);
  }

  async loadProfile(userId: string): Promise<void> {
    const p = await this.request<ApiProfile>("GET", `/v1/users/${userId}`);
    const known = this.state.users[userId];
    const user = { ...this.toUser({ ...p.user }), email: known?.email ?? "", phone: known?.phone };
    const ownedPets = [
      ...this.state.ownedPets.filter((o) => o.ownerId !== userId || userId === this.state.sessionUserId),
      ...(userId === this.state.sessionUserId
        ? []
        : p.pets.map((pet) => ({
            id: pet.id,
            ownerId: userId,
            name: pet.name,
            species: pet.species,
            breed: pet.breed,
            sex: pet.sex ?? "unknown",
            age: pet.age ?? "unknown",
            size: pet.size ?? "medium",
            color: pet.color,
            collar: pet.collar,
            description: pet.description ?? "",
            // Una API anterior solo enviaba la primera foto.
            photos: pet.photos ?? (pet.photo ? [pet.photo] : []),
            shyOrIndoor: pet.shyOrIndoor ?? false,
            createdAt: user.createdAt,
          }))),
    ];
    this.commit({
      users: { ...this.state.users, [userId]: user },
      remoteBadges: { ...this.state.remoteBadges, [userId]: p.badges },
      remoteRatings: { ...this.state.remoteRatings, [userId]: { average: p.rating, count: p.ratingCount } },
      shelterSummaries: p.shelter
        ? { ...this.state.shelterSummaries, [userId]: p.shelter }
        : Object.fromEntries(Object.entries(this.state.shelterSummaries).filter(([id]) => id !== userId)),
      followInfo: {
        ...this.state.followInfo,
        [userId]: { followers: p.followers, following: p.following, status: p.followStatus },
      },
      ownedPets,
    });
    this.setLikes(userId, p.likes, p.likedByMe);
  }

  /** Guarda a estas personas con su nombre de usuario, que el resumen de un caso no trae. */
  protected mergePeople(list: ApiPerson[]): Record<string, User> {
    const users = this.mergeSummaries(list);
    for (const person of list) {
      const known = users[person.id];
      if (known) users[person.id] = { ...known, username: person.username };
    }
    return users;
  }

  async searchUsers(query: string): Promise<User[]> {
    const list = await this.request<ApiPerson[]>("GET", `/v1/users/search?q=${encodeURIComponent(query)}`);
    const users = this.mergePeople(list);
    this.commit({ users });
    return list.map((p) => users[p.id] as User);
  }

  async loadNetwork(): Promise<void> {
    const me = this.state.sessionUserId;
    if (!me) return;
    const n = await this.request<ApiNetwork>("GET", "/v1/me/network");
    const ids = (list: ApiPerson[]) => list.map((p) => p.id);
    this.commit({
      users: this.mergePeople([...n.requests, ...n.followers, ...n.following, ...n.sent]),
      network: { requests: ids(n.requests), followers: ids(n.followers), following: ids(n.following), sent: ids(n.sent) },
      followInfo: {
        ...this.state.followInfo,
        [me]: { followers: n.followers.length, following: n.following.length, status: "none" },
      },
    });
  }

  /** Tras cambiar una relación: el número de seguidores y los "me gusta" pueden haber cambiado. */
  protected async refreshAfterFollow(userId: string): Promise<void> {
    await Promise.allSettled([this.loadNetwork(), this.loadProfile(userId)]);
  }

  async followUser(userId: string): Promise<FollowStatus> {
    const { status } = await this.request<{ status: FollowStatus }>("POST", `/v1/users/${userId}/follow`);
    await this.refreshAfterFollow(userId);
    return status;
  }

  async unfollowUser(userId: string): Promise<void> {
    await this.request("DELETE", `/v1/users/${userId}/follow`);
    await this.refreshAfterFollow(userId);
  }

  async acceptFollower(userId: string): Promise<void> {
    await this.request("POST", `/v1/me/followers/${userId}/accept`);
    await this.loadNetwork();
  }

  async removeFollower(userId: string): Promise<void> {
    await this.request("DELETE", `/v1/me/followers/${userId}`);
    await this.loadNetwork();
  }

  async loadStories(center: LatLng): Promise<void> {
    const list = await this.request<ApiStory[]>("GET", `/v1/stories?lat=${center.latitude}&lng=${center.longitude}`);
    this.mergePets(list.map((s) => s.pet));
    const ids = new Set(list.map((s) => s.pet.id));
    this.commit({
      stories: [...this.state.stories.filter((s) => !ids.has(s.petId)), ...list.flatMap((s) => s.items as StoryItem[])],
    });
  }

  async registerPushToken(token: string, platform: "android" | "ios"): Promise<void> {
    if (!this.tokens) return;
    await this.request("POST", "/v1/me/devices", { token, platform });
    this.pushToken = token;
  }

  async loadPlaces(center: LatLng): Promise<void> {
    // Al servidor solo llega una celda de ~1 km: las distancias exactas se calculan en el celular.
    const cell = approximateLocation(center, 1000);
    const { places } = await this.request<{ places: Place[] }>(
      "GET",
      `/v1/places?lat=${cell.latitude.toFixed(4)}&lng=${cell.longitude.toFixed(4)}&radius=15000`,
    );
    this.commit({ places });
  }
}
