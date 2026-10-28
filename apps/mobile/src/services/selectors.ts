import { distanceMeters } from "@/domain/geo";
import type { AppNotification, LatLng, Message, PetCase, Species, Thread, User } from "@/domain/types";

import type { BackendState } from "./backendTypes";

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

export type UserStats = { reported: number; found: number; ratingAvg: number | null; ratingCount: number };

export function userStats(state: BackendState, userId: string): UserStats {
  const own = state.pets.filter((p) => p.ownerId === userId);
  const user = state.users[userId];
  const ratingCount = user?.ratingCount ?? 0;
  return {
    reported: own.filter((p) => p.kind === "lost").length,
    found: own.filter((p) => p.kind === "found").length,
    ratingAvg: ratingCount > 0 && user ? Math.round((user.ratingSum / ratingCount) * 10) / 10 : null,
    ratingCount,
  };
}

export type BadgeId = "verified" | "first_report" | "first_rescue" | "reunion" | "ten_reports" | "community";

/** Insignias calculadas a partir de actividad real (issue #61, sin datos inventados). */
export function userBadges(state: BackendState, userId: string): BadgeId[] {
  const user = state.users[userId];
  if (!user) return [];
  const own = state.pets.filter((p) => p.ownerId === userId);
  const groupsJoined = state.threads.filter((t) => t.kind === "group" && t.memberIds.includes(userId)).length;
  const badges: BadgeId[] = [];
  if (user.phoneVerified) badges.push("verified");
  if (own.length >= 1) badges.push("first_report");
  if (own.some((p) => p.kind === "found")) badges.push("first_rescue");
  if (own.some((p) => p.state === "reunited")) badges.push("reunion");
  if (own.length >= 10) badges.push("ten_reports");
  if (groupsJoined >= 3) badges.push("community");
  return badges;
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
