import type { Lang, Message, PetCase, Thread, User } from "@/domain/types";
import type { TKey, TParams } from "@/i18n/core";

type T = (key: TKey, params?: TParams) => string;

const petName = (pet: PetCase | undefined, t: T) => pet?.name ?? t("common.unnamed");

/** Título del hilo: nombre fijo del grupo de caso, o el nombre corto de la otra persona. */
export function threadTitle(
  thread: Thread,
  pet: PetCase | undefined,
  counterpart: User | undefined,
  t: T,
  shortName: (n: string) => string,
): string {
  if (thread.kind === "group") {
    return pet?.kind === "lost" ? t("messages.groupLost", { name: petName(pet, t) }) : t("messages.groupFound");
  }
  return counterpart ? shortName(counterpart.name) : t("common.deletedUser");
}

/** Texto visible de un mensaje; los de sistema guardan un código y se traducen al mostrarlos. */
export function messageText(message: Message, pet: PetCase | undefined, t: T): string {
  if (message.kind === "system") {
    if (message.text === "created") return t("chat.created");
    if (message.text === "joined") return t("chat.joined", { name: message.authorShortName || t("common.deletedUser") });
    if (message.text === "reunited") return t("chat.reunitedMsg", { name: petName(pet, t) });
    if (message.text === "closed") return t("chat.closedMsg", { name: message.authorShortName || t("common.deletedUser") });
    return message.text;
  }
  if (message.kind === "sighting") return t("chat.sightingMsg", { name: message.authorShortName, zone: message.text });
  return message.text;
}

export type LocalizedText = {
  text: string;
  /** Idioma original si se está mostrando una traducción. */
  translatedFrom?: Lang;
  /** Idioma original si difiere del lector y no hay traducción disponible. */
  untranslatedFrom?: Lang;
};

/**
 * Texto de un mensaje para quien lo lee: su traducción si el autor escribió en otro
 * idioma y la traducción automática está activa; si no existe traducción, el original
 * marcado como tal (nunca una traducción inventada en el cliente).
 */
export function localizedText(message: Message, viewer: Lang, autoTranslate: boolean, showOriginal = false): LocalizedText {
  if (message.kind !== "text" || !message.lang || message.lang === viewer) return { text: message.text };
  const translation = message.translations?.[viewer];
  if (autoTranslate && translation && !showOriginal) return { text: translation, translatedFrom: message.lang };
  if (!translation) return { text: message.text, untranslatedFrom: message.lang };
  return { text: message.text };
}

/** Vista previa para la lista: "María G.: ¿Alguien lo ha visto…?" / "Tú: …". */
export function messagePreview(
  message: Message | undefined,
  pet: PetCase | undefined,
  userId: string,
  t: T,
  viewer: Lang = "es",
  autoTranslate = true,
): string {
  if (!message) return "";
  const localized = message.kind === "text" ? localizedText(message, viewer, autoTranslate).text : messageText(message, pet, t);
  const text = message.photo && !localized ? t("chat.photo") : localized;
  if (message.kind !== "text") return text;
  const author = message.authorId === userId ? t("common.you") : message.authorShortName || t("common.deletedUser");
  return `${author}: ${text}`;
}
