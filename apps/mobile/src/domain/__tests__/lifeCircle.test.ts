import fixture from "../../../../../packages/contracts/fixtures/life-circle.json";
import {
  currentRadius,
  growthSnapshot,
  hoursToCap,
  LIFE_CIRCLE_PROFILES,
  profileFor,
  projection,
  radiusInFuture,
  radiusMeters,
  type LifeCircleProfile,
} from "../lifeCircle";
import type { PetCase } from "../types";

const NOW = new Date("2026-10-27T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const pet = (over: Partial<PetCase>): PetCase =>
  ({
    id: "p",
    kind: "lost",
    state: "active",
    species: "dog",
    sex: "male",
    age: "adult",
    size: "large",
    description: "",
    photos: [],
    traumaticEvent: false,
    shyOrIndoor: false,
    lastSeenAt: hoursAgo(0),
    location: { latitude: 6.24, longitude: -75.59 },
    zone: "Laureles",
    reward: false,
    ownerId: "u",
    ownerShortName: "U.",
    createdAt: hoursAgo(0),
    sightings: [],
    shareCount: 0,
    groupId: "g",
    ...over,
  }) as PetCase;

describe("tabla del círculo de vida (PRODUCT.md, issue #10)", () => {
  it("coincide con los parámetros fijados por producto", () => {
    expect(LIFE_CIRCLE_PROFILES).toEqual({
      dog_panic: { initial: 1000, rate: 1200, cap: 8000 },
      dog_calm: { initial: 500, rate: 400, cap: 4000 },
      cat_or_shy: { initial: 150, rate: 60, cap: 800 },
      unknown: { initial: 300, rate: 250, cap: 5000 },
    });
  });

  it.each(fixture.cases)(
    "radiusMeters($profile, $hours h) = $meters m (fixture compartido con la API)",
    ({ profile, hours, meters }) => {
      expect(radiusMeters(profile as LifeCircleProfile, hours)).toBe(meters);
    },
  );

  it("nunca supera el tope ni baja del radio inicial", () => {
    for (const [profile, { initial, cap }] of Object.entries(LIFE_CIRCLE_PROFILES)) {
      expect(radiusMeters(profile as LifeCircleProfile, 0)).toBe(initial);
      expect(radiusMeters(profile as LifeCircleProfile, 10_000)).toBe(cap);
    }
  });

  it("trata horas negativas o inválidas como cero", () => {
    expect(radiusMeters("dog_calm", -5)).toBe(500);
    expect(radiusMeters("dog_calm", Number.NaN)).toBe(500);
  });

  it("crece de forma monótona", () => {
    let last = 0;
    for (let h = 0; h <= 200; h += 0.5) {
      const r = radiusMeters("dog_panic", h);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("profileFor", () => {
  it.each`
    species    | traumaticEvent | shyOrIndoor | expected
    ${"cat"}   | ${false}       | ${false}    | ${"cat_or_shy"}
    ${"cat"}   | ${true}        | ${false}    | ${"cat_or_shy"}
    ${"dog"}   | ${true}        | ${true}     | ${"dog_panic"}
    ${"dog"}   | ${false}       | ${true}     | ${"cat_or_shy"}
    ${"dog"}   | ${false}       | ${false}    | ${"dog_calm"}
    ${"other"} | ${false}       | ${true}     | ${"cat_or_shy"}
    ${"other"} | ${true}        | ${false}    | ${"unknown"}
  `(
    "$species traumático=$traumaticEvent tímida=$shyOrIndoor → $expected",
    ({ species, traumaticEvent, shyOrIndoor, expected }) => {
      expect(profileFor({ species, traumaticEvent, shyOrIndoor })).toBe(expected);
    },
  );
});

describe("radio vigente y proyección", () => {
  it("usa el último avistamiento para las perdidas", () => {
    expect(currentRadius(pet({ lastSeenAt: hoursAgo(4) }), NOW)).toBe(radiusMeters("dog_calm", 4));
  });

  it("usa el radio fijo elegido para las encontradas", () => {
    expect(currentRadius(pet({ kind: "found", foundSearchRadius: 2000 }), NOW)).toBe(2000);
    expect(currentRadius(pet({ kind: "found" }), NOW)).toBe(400);
  });

  it("proyecta el crecimiento futuro solo para perdidas", () => {
    const lost = pet({ lastSeenAt: hoursAgo(1) });
    expect(radiusInFuture(lost, NOW, 24)).toBe(radiusMeters("dog_calm", 25));
    expect(radiusInFuture(lost, NOW, -3)).toBe(radiusMeters("dog_calm", 1));
    expect(radiusInFuture(pet({ kind: "found", foundSearchRadius: 1000 }), NOW, 24)).toBe(1000);
  });

  it("projection devuelve los hitos pedidos", () => {
    expect(projection("cat_or_shy", [0, 4])).toEqual([
      { hours: 0, meters: 150 },
      { hours: 4, meters: 270 },
    ]);
  });

  it("hoursToCap es el punto donde la fórmula alcanza el tope", () => {
    const h = hoursToCap("dog_calm");
    expect(radiusMeters("dog_calm", h)).toBe(4000);
    expect(radiusMeters("dog_calm", h - 1)).toBeLessThan(4000);
  });

  it("growthSnapshot explica cuánto crecerá y si llegó al máximo", () => {
    const fresh = growthSnapshot(pet({ traumaticEvent: true, lastSeenAt: hoursAgo(1) }), NOW);
    expect(fresh).toMatchObject({ profile: "dog_panic", current: 2200, cap: 8000, atCap: false, pctOfCap: 28 });
    expect(fresh.nextHourGrowth).toBe(radiusMeters("dog_panic", 2) - 2200);

    const old = growthSnapshot(pet({ species: "cat", lastSeenAt: hoursAgo(1000) }), NOW);
    expect(old).toMatchObject({ atCap: true, nextHourGrowth: 0, pctOfCap: 100 });
  });
});
