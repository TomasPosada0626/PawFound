import { en } from "./en";
import { es } from "./es";

/** Entrada con plural: se elige `one` u `other` según `count`. */
export type Plural = { one: string; other: string };

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? Plural : Widen<T[K]> };

/** Forma del diccionario: el español es la fuente; el inglés debe tener exactamente las mismas claves. */
export type Translations = Widen<typeof es>;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Leaves<Translations>;
export type TParams = Record<string, string | number>;

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const dictionaries: Record<Locale, Translations> = { es, en };

export function resolveLocale(languageCode: string | null | undefined): Locale {
  return languageCode === "en" ? "en" : "es";
}

function lookup(dict: Translations, key: string): string | Plural | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in node) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node as string | Plural | undefined;
}

export function translate(locale: Locale, key: TKey, params?: TParams): string {
  const entry = lookup(dictionaries[locale], key) ?? lookup(dictionaries.es, key);
  if (entry === undefined) return key;
  const template = typeof entry === "string" ? entry : Number(params?.count) === 1 ? entry.one : entry.other;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** Lista de textos (p. ej. consejos) guardada como string separado por "|". */
export function translateList(locale: Locale, key: TKey): string[] {
  return translate(locale, key)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}
