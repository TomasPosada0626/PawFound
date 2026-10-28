/**
 * Convivencia sin bloqueos (decisión de producto): nadie bloquea a nadie; se reporta y el
 * equipo de moderación decide. Este módulo tiene las piezas que corren en la app:
 * - Un aviso amable antes de enviar un mensaje que podría sonar ofensivo (no lo impide).
 * - La antigüedad de la cuenta, que da contexto de confianza en perfiles y chats.
 * El antispam real (límites por minuto, duplicados, sanciones) vive en el servidor.
 */

/** Lista corta y conservadora (es/en). Solo dispara un "¿Lo enviamos así?", nunca censura. */
const OFFENSIVE = [
  "idiota",
  "estupido",
  "estupida",
  "imbecil",
  "malparido",
  "malparida",
  "hijueputa",
  "gonorrea",
  "pendejo",
  "pendeja",
  "marica",
  "huevon",
  "huevona",
  "puta",
  "mierda",
  "idiot",
  "stupid",
  "moron",
  "asshole",
  "bitch",
  "fuck",
  "shit",
];

const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n");

export function mightBeOffensive(text: string): boolean {
  const words = fold(text).split(/[^a-z0-9]+/);
  return words.some((w) => OFFENSIVE.includes(w));
}

/** Días completos desde que se creó la cuenta (mínimo 0). */
export function memberDays(createdAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000));
}
