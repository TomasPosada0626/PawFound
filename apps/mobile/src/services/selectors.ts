import { BADGE_RULES, badgeProgress, type BadgeFacts, type BadgeProgress } from "@/domain/badges";
import { distanceMeters } from "@/domain/geo";
import { isAnimalProtector, ratingAverage } from "@/domain/rating";
import type { AppNotification, LatLng, Message, OwnedPet, PetCase, Species, StoryItem, Thread, User } from "@/domain/types";

import type { Adoption, ShelterSummary } from "@/domain/adoption";
import type { BackendState, FollowInfo, Network, RatingInfo } from "./backendTypes";

/** Quita tildes sin depender de String.normalize (soporte parcial en Hermes). */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n");
}

export type KindFilter = "all" | "lost" | "found";

export type PetFilters = {
  kind: KindFilter;
  species: Species | "any";
  /** Metros; null = sin límite. */
  maxDistance: number | null;
  /** Horas desde el último avistamiento; null = cualquier fecha. */
  withinHours: number | null;
  query: string;
};

export const DEFAULT_FILTERS: PetFilters = { kind: "all", species: "any", maxDistance: null, withinHours: null, query: "" };

export function matchesQuery(pet: PetCase, query: string): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  const haystack = foldText([pet.name, pet.breed, pet.zone, pet.color, pet.description].filter(Boolean).join(" "));
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

export type PetWithDistance = { pet: PetCase; distance: number };

/** Casos activos que cumplen los filtros, ordenados por cercanía. */
export function filterPets(pets: PetCase[], center: LatLng, now: Date, filters: PetFilters): PetWithDistance[] {
  return pets
    .filter((p) => p.state === "active")
    .filter((p) => filters.kind === "all" || p.kind === filters.kind)
    .filter((p) => filters.species === "any" || p.species === filters.species)
    .filter(
      (p) => filters.withinHours === null || now.getTime() - new Date(p.lastSeenAt).getTime() <= filters.withinHours * 3_600_000,
    )
    .filter((p) => matchesQuery(p, filters.query))
    .map((pet) => ({ pet, distance: distanceMeters(center, pet.location) }))
    .filter(({ distance }) => filters.maxDistance === null || distance <= filters.maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

export function threadsForUser(state: BackendState, userId: string, kind: Thread["kind"]): Thread[] {
  return state.threads
    .filter((t) => t.kind === kind && t.memberIds.includes(userId))
    .sort((a, b) => (lastMessage(state, b.id)?.at ?? "").localeCompare(lastMessage(state, a.id)?.at ?? ""));
}

export function threadMessages(state: BackendState, threadId: string): Message[] {
  return state.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.at.localeCompare(b.at));
}

export function lastMessage(state: BackendState, threadId: string): Message | undefined {
  let last: Message | undefined;
  for (const m of state.messages) if (m.threadId === threadId && (!last || m.at > last.at)) last = m;
  return last;
}

export function unreadCount(state: BackendState, thread: Thread, userId: string): number {
  const readAt = thread.readAt[userId] ?? "";
  return state.messages.filter((m) => m.threadId === thread.id && m.authorId !== userId && m.at > readAt).length;
}

export function userNotifications(state: BackendState, userId: string): AppNotification[] {
  return state.notifications.filter((n) => n.userId === userId).sort((a, b) => b.at.localeCompare(a.at));
}

/** Total para el punto del tab "Mensajes": chats/grupos no silenciados + notificaciones. */
export function totalUnread(state: BackendState, userId: string | null): number {
  if (!userId) return 0;
  const threads = state.threads.filter((t) => t.memberIds.includes(userId) && !t.mutedBy.includes(userId));
  const messages = threads.reduce((sum, t) => sum + unreadCount(state, t, userId), 0);
  const notifications = state.notifications.filter((n) => n.userId === userId && !n.read).length;
  return messages + notifications;
}

export function counterpart(state: BackendState, thread: Thread, userId: string): User | undefined {
  const otherId = thread.memberIds.find((id) => id !== userId);
  return otherId ? state.users[otherId] : undefined;
}

export type UserStats = { reported: number; found: number; ratingAvg: number; ratingCount: number };

const NO_NETWORK: Network = { requests: [], followers: [], following: [], sent: [] };

export function networkOf(state: BackendState): Network {
  return state.network ?? NO_NETWORK;
}

export function followInfoOf(state: BackendState, userId: string): FollowInfo {
  return state.followInfo?.[userId] ?? { followers: 0, following: 0, status: "none" };
}

/** Toda cuenta empieza en 5 estrellas (rating.ts); con la API el promedio viene calculado. */
export function ratingOf(state: BackendState, userId: string): RatingInfo {
  const remote = state.remoteRatings?.[userId];
  if (remote) return remote;
  const stars = state.ratingStars?.[userId] ?? [];
  return { average: ratingAverage(stars), count: stars.length };
}

export function userStats(state: BackendState, userId: string): UserStats {
  const own = state.pets.filter((p) => p.ownerId === userId);
  const rating = ratingOf(state, userId);
  return {
    reported: own.filter((p) => p.kind === "lost").length,
    found: own.filter((p) => p.kind === "found").length,
    ratingAvg: rating.average,
    ratingCount: rating.count,
  };
}

const QUICK_RESPONSE_MS = 60 * 60 * 1000;

/** Hechos reales que cuentan para cada insignia (los reportes retirados por moderación no cuentan). */
export function badgeFacts(state: BackendState, userId: string): BadgeFacts {
  const user = state.users[userId];
  const valid = state.pets.filter((p) => !p.moderationRemoved);
  const own = valid.filter((p) => p.ownerId === userId);
  const ownGroups = new Set(own.map((p) => p.groupId));
  return {
    verified: user?.verified ? 1 : 0,
    reporter: own.length,
    rescuer: own.filter((p) => p.kind === "found").length,
    eyes: valid
      .filter((p) => p.ownerId !== userId)
      .reduce((sum, p) => sum + p.sightings.filter((s) => s.authorId === userId).length, 0),
    paw_angel: valid.filter((p) => p.helperIds?.includes(userId)).length,
    reunion: own.filter((p) => p.state === "reunited").length,
    quick: valid.filter(
      (p) =>
        p.ownerId !== userId &&
        p.sightings.some((s) => s.authorId === userId && Date.parse(s.at) - Date.parse(p.createdAt) <= QUICK_RESPONSE_MS),
    ).length,
    protector: isAnimalProtector(state.ratingStars?.[userId] ?? []) ? 1 : 0,
    popular: (state.profileLikes[userId] ?? []).length,
    new_member: (state.adoptionApplications ?? []).filter(
      (a) =>
        a.applicantId === userId &&
        a.status === "accepted" &&
        state.adoptions?.find((d) => d.id === a.adoptionId)?.status === "adopted",
    ).length,
    spreader: (state.shareLog[userId] ?? []).length,
    community: state.threads.filter((t) => t.kind === "group" && t.memberIds.includes(userId) && !ownGroups.has(t.id)).length,
  };
}

/** Progreso de todas las insignias; en producción lo calcula y devuelve la API. */
export function userBadgeProgress(state: BackendState, userId: string): BadgeProgress[] {
  const remote = state.remoteBadges[userId];
  // Una versión más nueva de la API puede traer insignias que esta app todavía no conoce.
  if (remote) return remote.filter((b) => BADGE_RULES[b.id]);
  if (!state.users[userId]) return [];
  return badgeProgress(badgeFacts(state, userId));
}

export type HelperReason = "sighting" | "group" | "direct";
export type HelperCandidate = { user: User; userId: string; reasons: HelperReason[] };

/**
 * Personas que participaron en el caso y a las que la familia puede agradecer al cerrarlo:
 * reportaron un avistamiento, escribieron en el grupo o le escribieron por mensaje directo.
 */
export function reunionHelperCandidates(state: BackendState, petId: string): HelperCandidate[] {
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet) return [];
  const reasons = new Map<string, Set<HelperReason>>();
  const add = (userId: string, reason: HelperReason) => {
    if (userId === pet.ownerId || !state.users[userId]) return;
    const set = reasons.get(userId) ?? new Set<HelperReason>();
    set.add(reason);
    reasons.set(userId, set);
  };
  for (const s of pet.sightings) add(s.authorId, "sighting");
  for (const m of state.messages) {
    if (m.threadId === pet.groupId && m.kind !== "system") add(m.authorId, m.kind === "sighting" ? "sighting" : "group");
  }
  const directThreads = new Set(
    state.threads.filter((t) => t.kind === "dm" && t.petId === petId && t.memberIds.includes(pet.ownerId)).map((t) => t.id),
  );
  for (const m of state.messages) if (directThreads.has(m.threadId) && m.kind === "text") add(m.authorId, "direct");
  return [...reasons.entries()]
    .map(([userId, set]) => ({ userId, user: state.users[userId] as User, reasons: [...set] }))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.user.name.localeCompare(b.user.name));
}

export function likesOf(state: BackendState, userId: string): number {
  return (state.profileLikes[userId] ?? []).length;
}

export function hasLiked(state: BackendState, fromId: string | null, toId: string): boolean {
  return Boolean(fromId && state.profileLikes[toId]?.includes(fromId));
}

export function ownedPetsOf(state: BackendState, userId: string): OwnedPet[] {
  return state.ownedPets.filter((p) => p.ownerId === userId);
}

export type ActivityItem = { pet: PetCase; kind: "lost" | "found" | "reunited"; at: string };

export function userActivity(state: BackendState, userId: string): ActivityItem[] {
  return state.pets
    .filter((p) => p.ownerId === userId)
    .flatMap<ActivityItem>((pet) => [
      { pet, kind: pet.kind, at: pet.createdAt },
      ...(pet.reunitedAt ? [{ pet, kind: "reunited" as const, at: pet.reunitedAt }] : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
}

export type StoryEntry = { pet: PetCase; items: StoryItem[]; updatedAt: string };

/** Historias de los casos activos cerca (10 km), las que tienen novedades más recientes primero. */
export function storyFeed(state: BackendState, center: LatLng, now: Date, radius = 10_000): StoryEntry[] {
  return filterPets(state.pets, center, now, { ...DEFAULT_FILTERS, maxDistance: radius })
    .filter(({ pet }) => !pet.moderationRemoved)
    .map(({ pet }) => {
      const items = state.stories.filter((s) => s.petId === pet.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const updatedAt = [pet.createdAt, pet.lastSeenAt, ...items.map((i) => i.createdAt)].sort().at(-1) ?? pet.createdAt;
      return { pet, items, updatedAt };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type StorySlide =
  | { id: string; type: "info" }
  | { id: string; type: "photo"; uri: string }
  | { id: string; type: "update"; uri?: string; text: string; at: string; authorId: string };

/** Partes de la historia: la ficha del caso, sus fotos y las actualizaciones de la familia. */
export function storySlides(pet: PetCase, stories: StoryItem[]): StorySlide[] {
  return [
    { id: `${pet.id}:info`, type: "info" as const },
    ...pet.photos.map((uri, i) => ({ id: `${pet.id}:photo:${i}`, type: "photo" as const, uri })),
    ...stories
      .filter((s) => s.petId === pet.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((s) => ({ id: s.id, type: "update" as const, uri: s.photo, text: s.text, at: s.createdAt, authorId: s.authorId })),
  ];
}

export function storySlideIds(pet: PetCase, items: StoryItem[]): string[] {
  return storySlides(pet, items).map((s) => s.id);
}

/**
 * Una publicación de PawFamily vista por la cuenta actual: la dirección solo para quien publicó o
 * para quien fue aceptado, y las solicitudes por responder solo para quien publicó.
 */
/** Refugio verificado: lo que trae la API o, en la demostración, lo que hay en el estado. */
export function shelterSummaryOf(state: BackendState, userId: string): ShelterSummary | undefined {
  const remote = state.shelterSummaries?.[userId];
  if (remote) return remote;
  const user = state.users[userId];
  if (user?.shelterStatus !== "verified" || !user.shelterName) return undefined;
  const own = (state.adoptions ?? []).filter((a) => a.ownerId === userId);
  return {
    name: user.shelterName,
    available: own.filter((a) => a.status === "available" || a.status === "in_process").length,
    adopted: own.filter((a) => a.status === "adopted").length,
  };
}

export function adoptionView(state: BackendState, id: string): Adoption | undefined {
  const adoption = state.adoptions?.find((a) => a.id === id);
  if (!adoption) return undefined;
  const me = state.sessionUserId;
  const applications = (state.adoptionApplications ?? []).filter((a) => a.adoptionId === id);
  const mine = applications.find((a) => a.applicantId === me)?.status ?? adoption.myApplication;
  const isOwner = adoption.ownerId === me;
  return {
    ...adoption,
    address: isOwner || mine === "accepted" ? adoption.address : undefined,
    myApplication: mine,
    pending: isOwner
      ? applications.length
        ? applications.filter((a) => a.status === "pending").length
        : (adoption.pending ?? 0)
      : undefined,
  };
}
