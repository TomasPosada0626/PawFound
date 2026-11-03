import type { PetCase } from "@/domain/types";
import { notificationTexts } from "@/features/notifications";
import { petDisplayName, petSentence, petShareMessage } from "@/features/petNames";
import { translate, type Locale, type TKey, type TParams } from "@/i18n/core";

const es = (key: TKey, params?: TParams) => translate("es", key, params);
const en = (key: TKey, params?: TParams) => translate("en" as Locale, key, params);

function pet(overrides: Partial<PetCase>): PetCase {
  return { kind: "found", species: "dog", sex: "unknown", zone: "Laureles", ...overrides } as PetCase;
}

describe("mascotas sin nombre", () => {
  it.each([
    [{ species: "dog", sex: "unknown" }, "Perrito encontrado"],
    [{ species: "dog", sex: "male" }, "Perrito encontrado"],
    [{ species: "dog", sex: "female" }, "Perrita encontrada"],
    [{ species: "cat", sex: "unknown" }, "Gatico encontrado"],
    [{ species: "cat", sex: "female" }, "Gatica encontrada"],
    [{ species: "other", sex: "male" }, "Mascota encontrada"],
    [{ species: "dog", sex: "female", kind: "lost" }, "Perrita perdida"],
  ] as [Partial<PetCase>, string][])("%j se muestra como %s", (overrides, label) => {
    expect(petDisplayName(pet(overrides), es)).toBe(label);
  });

  it("traduce el nombre y respeta el nombre conocido", () => {
    expect(petDisplayName(pet({ species: "cat" }), en)).toBe("Found cat");
    expect(petDisplayName(pet({ name: "Rocky" }), es)).toBe("Rocky");
    expect(petSentence(es, "notifications.body_sighting", pet({ name: "Rocky" }))).toBe("Alguien vio a Rocky");
  });

  it("escribe las frases con buena gramática", () => {
    const dog = pet({});
    const cat = pet({ species: "cat", sex: "female" });
    expect(petSentence(es, "notifications.body_sighting", dog)).toBe("Alguien vio al perrito encontrado");
    expect(petSentence(es, "notifications.body_sighting", cat)).toBe("Alguien vio a la gatica encontrada");
    expect(petSentence(es, "notifications.body_comment", dog)).toBe("Alguien comentó en el reporte del perrito encontrado");
    expect(petSentence(es, "notifications.body_case_closed", cat)).toBe("La gatica encontrada ya está en casa");
    expect(petSentence(es, "pet.reuniteConfirmTitle", dog)).toBe("¿El perrito encontrado ya está en casa?");
    expect(petSentence(es, "story.homeThanks", dog)).toBe("Gracias por compartir. El perrito encontrado ya está con su familia.");
    expect(petSentence(es, "pet.thankedToast", dog, { count: 2 })).toContain("¡El perrito encontrado ya está en casa!");
    expect(petSentence(en, "notifications.body_case_closed", dog)).toBe("The found dog is back home");
  });

  it("no repite la especie al compartir un caso sin nombre", () => {
    expect(petShareMessage(pet({}), es, "https://x/1")).toBe(
      "🐾 Perrito encontrado en Laureles. ¿Sabes de quién es? https://x/1",
    );
    expect(petShareMessage(pet({ name: "Rocky", kind: "lost" }), es, "https://x/1")).toContain("Rocky (perro) en Laureles");
  });

  it("en una coincidencia con mascota propia usa el nombre de esa mascota", () => {
    expect(notificationTexts({ kind: "owned_match" }, pet({}), "Rocky", es).title).toBe("¿Es Rocky?");
    expect(notificationTexts({ kind: "sighting" }, pet({}), undefined, es).body).toBe("Alguien vio al perrito encontrado");
    // Recordatorios a la familia de una perdida sin nombre.
    const lost = pet({ kind: "lost", sex: "female" });
    expect(notificationTexts({ kind: "case_reminder" }, lost, undefined, es).title).toBe("¿Ya apareció la perrita perdida?");
    expect(notificationTexts({ kind: "case_archived" }, lost, undefined, es).title).toBe(
      "Archivamos el caso de la perrita perdida",
    );
    expect(notificationTexts({ kind: "archive_warning" }, pet({ name: "Max" }), undefined, es).title).toBe(
      "¿Hay novedades de Max?",
    );
  });
});
