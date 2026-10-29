import fixture from "../../../../../packages/contracts/fixtures/owned-matches.json";
import { colorTokens, matchOwned, ownedMatches, ownedMatchRadius } from "../matching";
import type { OwnedPet, PetCase } from "../types";

type FixtureCase = (typeof fixture.cases)[number];

const found = (c: FixtureCase["found"]) =>
  ({ ...c, kind: "found", breed: c.breed || undefined, color: c.color || undefined }) as Parameters<typeof matchOwned>[0];

const owned = (c: FixtureCase["owned"]) =>
  ({ ...c, breed: c.breed || undefined, color: c.color || undefined }) as Parameters<typeof matchOwned>[1];

describe("¿Es tu mascota? — vectores compartidos con la API", () => {
  it.each(fixture.cases.map((c) => [c.name, c]))("%s", (_name, c) => {
    const score = matchOwned(found(c.found), owned(c.owned));
    expect(score !== null).toBe(c.match);
    expect(score === null ? 0 : Math.round(score * 1000) / 1000).toBe(c.score);
  });

  it("un reporte de pérdida nunca es coincidencia de una mascota propia", () => {
    const c = fixture.cases[0] as FixtureCase;
    expect(matchOwned({ ...found(c.found), kind: "lost" }, owned(c.owned))).toBeNull();
  });
});

describe("piezas de la regla", () => {
  it("normaliza colores por raíz y sin tildes", () => {
    expect([...colorTokens("Negra con BLANCO")]).toEqual(["negr", "blan"]);
    expect([...colorTokens("café")]).toEqual(["cafe"]);
    expect(colorTokens(undefined).size).toBe(0);
  });

  it("el radio depende de la especie", () => {
    expect(ownedMatchRadius("dog")).toBe(8500);
    expect(ownedMatchRadius("cat")).toBe(1300);
    expect(ownedMatchRadius("other")).toBe(5500);
  });

  it("ordena por puntaje y excluye reportes propios, retirados o sin zona", () => {
    const rocky: OwnedPet = {
      id: "own_1",
      ownerId: "u_1",
      name: "Rocky",
      species: "dog",
      breed: "Criollo",
      sex: "male",
      age: "adult",
      size: "medium",
      color: "Negro",
      description: "",
      photos: [],
      shyOrIndoor: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const zone = { latitude: 6.2447, longitude: -75.5916 };
    const base = {
      kind: "found",
      state: "active",
      species: "dog",
      sex: "male",
      size: "medium",
      color: "negro",
      location: { latitude: 6.2537, longitude: -75.5916 },
      ownerId: "u_2",
    } as PetCase;
    const close = { ...base, id: "a", breed: "criollo" } as PetCase;
    const farther = { ...base, id: "b", location: { latitude: 6.27, longitude: -75.5916 } } as PetCase;
    const mine = { ...base, id: "c", ownerId: "u_1" } as PetCase;
    const removed = { ...base, id: "d", moderationRemoved: true } as PetCase;
    const result = ownedMatches(rocky, zone, [farther, mine, removed, close]);
    expect(result.map((m) => m.pet.id)).toEqual(["a", "b"]);
    expect(result[0]?.distance).toBeGreaterThan(900);
    expect(ownedMatches(rocky, undefined, [close])).toEqual([]);
  });
});
