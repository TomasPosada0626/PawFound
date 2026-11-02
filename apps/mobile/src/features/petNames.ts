import type { PetCase } from "@/domain/types";
import type { TKey, TParams } from "@/i18n/core";

type T = (key: TKey, params?: TParams) => string;
type NamedPet = Pick<PetCase, "name" | "kind" | "species" | "sex">;

/** Si no se sabe el sexo se usa el masculino genérico; "mascota" siempre es femenino. */
function gender(pet: NamedPet): "m" | "f" {
  return pet.species === "other" || pet.sex === "female" ? "f" : "m";
}

function noun(pet: NamedPet, t: T): string {
  return pet.species === "other" ? t("unnamedPet.other") : t(`unnamedPet.${pet.species}_${gender(pet)}`);
}

/** Nombre para títulos y listas. Sin nombre conocido: "Perrito encontrado", "Gatica perdida". */
export function petDisplayName(pet: NamedPet, t: T): string {
  if (pet.name) return pet.name;
  const label = t(`unnamedPet.label_${pet.kind}_${gender(pet)}`, { pet: noun(pet, t) });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Texto con el nombre dentro de una frase. Sin nombre conocido usa "el perrito encontrado",
 * contrae "a el" y "de el", y pone mayúscula si la frase empieza por el artículo.
 */
export function petSentence(t: T, key: TKey, pet: NamedPet, params?: TParams): string {
  if (pet.name) return t(key, { ...params, name: pet.name });
  const name = t(`unnamedPet.the_${pet.kind}_${gender(pet)}`, { pet: noun(pet, t) });
  return t(key, { ...params, name })
    .replace(/(^|\s)a el /g, "$1al ")
    .replace(/(^|\s)de el /g, "$1del ")
    .replace(
      /(^|[.!?] |[¿¡])(el|la|the) /g,
      (_, before: string, word: string) => `${before}${word.charAt(0).toUpperCase()}${word.slice(1)} `,
    );
}

/** Mensaje al compartir un caso. Sin nombre, la especie y el estado ya van en "Perrito encontrado". */
export function petShareMessage(pet: NamedPet & Pick<PetCase, "zone">, t: T, url: string): string {
  const name = petDisplayName(pet, t);
  if (!pet.name) return t("pet.shareMessageUnnamed", { name, zone: pet.zone, url });
  return t("pet.shareMessage", {
    status: (pet.kind === "lost" ? t("status.lost") : t("status.found")).toUpperCase(),
    name,
    species: t(`speciesLower.${pet.species}`),
    zone: pet.zone,
    url,
  });
}
