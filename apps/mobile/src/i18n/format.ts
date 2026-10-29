import { translate, type Locale } from "./core";

/** "Hace 25 min", "Hace 1 hora", "Ayer", "Hace 3 días" o una fecha corta. */
export function relativeTime(iso: string, now: Date, locale: Locale): string {
  const diffMs = Math.max(0, now.getTime() - new Date(iso).getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return translate(locale, "time.now");
  if (minutes < 60) return translate(locale, "time.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(locale, "time.hours", { count: hours });
  if (hours < 48) return translate(locale, "time.yesterday");
  const days = Math.floor(hours / 24);
  if (days < 7) return translate(locale, "time.days", { count: days });
  return shortDate(new Date(iso), locale);
}

/** "15 ago." / "Aug 15" */
export function shortDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === "es" ? "es-CO" : "en-US", { day: "numeric", month: "short" });
}

/** "9:15 a. m." / "9:15 AM" */
export function clockTime(date: Date, locale: Locale): string {
  return date.toLocaleTimeString(locale === "es" ? "es-CO" : "en-US", { hour: "numeric", minute: "2-digit" });
}

/** Hora para la lista de chats: hora si es de hoy, "Ayer", o fecha corta. */
export function chatTimestamp(iso: string, now: Date, locale: Locale): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return clockTime(date, locale);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return translate(locale, "time.yesterday");
  return shortDate(date, locale);
}

/** Segundos → "0:45" */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
