import { APPROX_CELL_METERS, approximateLocation, distanceMeters, formatDistance, regionForRadius } from "../geo";
import { initials, maskEmail, maskPhone, shortName } from "../privacy";
import { caseGroupTitle, clusterPets, findPossibleMatches, impactStats, publishAllowance } from "../rules";
import type { PetCase } from "../types";
import {
  formatColombianMobile,
  hasErrors,
  isValidEmail,
  normalizeColombianMobile,
  passwordIssues,
  validateLogin,
  validateRegister,
  validateReport,
} from "../validation";

const NOW = new Date("2026-10-27T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const LAURELES = { latitude: 6.2449, longitude: -75.5912 };

const pet = (over: Partial<PetCase>): PetCase =>
  ({
    id: Math.random().toString(36),
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
    lastSeenAt: hoursAgo(1),
    location: LAURELES,
    zone: "Laureles",
    reward: false,
    ownerId: "u",
    ownerShortName: "U.",
    createdAt: hoursAgo(1),
    sightings: [],
    shareCount: 0,
    groupId: "g",
    ...over,
  }) as PetCase;

describe("geo", () => {
  it("calcula distancias haversine con precisión de metros", () => {
    expect(distanceMeters(LAURELES, LAURELES)).toBe(0);
    // ~1 km hacia el norte
    const d = distanceMeters(LAURELES, { latitude: LAURELES.latitude + 1000 / 111_320, longitude: LAURELES.longitude });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it("aproxima la ubicación sin alejarla más de una celda y de forma determinista", () => {
    const approx = approximateLocation(LAURELES);
    expect(approx).not.toEqual(LAURELES);
    expect(distanceMeters(approx, LAURELES)).toBeLessThanOrEqual(APPROX_CELL_METERS);
    expect(approximateLocation(LAURELES)).toEqual(approx);
  });

  it("puntos cercanos de la misma celda dan el mismo resultado (no se puede promediar)", () => {
    const a = approximateLocation({ latitude: 6.24401, longitude: -75.59101 });
    const b = approximateLocation({ latitude: 6.24402, longitude: -75.59102 });
    expect(a).toEqual(b);
  });

  it("la región cubre el diámetro del círculo con margen", () => {
    const region = regionForRadius(LAURELES, 1000);
    expect(region.latitudeDelta * 111_320).toBeGreaterThan(2000);
    expect(region.longitudeDelta).toBeGreaterThan(region.latitudeDelta);
  });

  it("formatea distancias según el idioma", () => {
    expect(formatDistance(4, "es")).toBe("10 m");
    expect(formatDistance(347, "es")).toBe("350 m");
    expect(formatDistance(1800, "es")).toBe("1,8 km");
    expect(formatDistance(1800, "en")).toBe("1.8 km");
    expect(formatDistance(12_400, "es")).toBe("12 km");
  });
});

describe("validation", () => {
  it("valida correos", () => {
    expect(isValidEmail("demo@pawfound.app")).toBe(true);
    expect(isValidEmail(" demo@pawfound.app ")).toBe(true);
    expect(isValidEmail("demo@pawfound")).toBe(false);
    expect(isValidEmail("demo pawfound.app")).toBe(false);
  });

  it.each([
    ["300 123 4567", "+573001234567"],
    ["+57 300-123-4567", "+573001234567"],
    ["573001234567", "+573001234567"],
    ["(310) 555 0000", "+573105550000"],
  ])("normaliza el celular %s", (input, expected) => {
    expect(normalizeColombianMobile(input)).toBe(expected);
  });

  it.each(["6041234567", "30012345", "+1 300 123 4567", "abc"])("rechaza %s (no es celular colombiano)", (input) => {
    expect(normalizeColombianMobile(input)).toBeNull();
  });

  it("da formato legible al celular", () => {
    expect(formatColombianMobile("+573001234567")).toBe("+57 300 123 4567");
  });

  it("explica qué le falta a la contraseña", () => {
    expect(passwordIssues("abc")).toEqual(["too_short", "needs_number"]);
    expect(passwordIssues("12345678")).toEqual(["needs_letter"]);
    expect(passwordIssues("PawFound2026")).toEqual([]);
  });

  it("valida el login", () => {
    expect(validateLogin({ email: "", password: "" })).toEqual({ email: "required", password: "required" });
    expect(validateLogin({ email: "x", password: "y" })).toEqual({ email: "invalid_email" });
  });

  it("exige ambos consentimientos y contraseñas iguales en el registro", () => {
    const base = {
      name: "Ana",
      email: "ana@x.co",
      phone: "3001234567",
      password: "Clave1234",
      confirm: "Clave1234",
      acceptTerms: true,
      confirmAge: true,
    };
    expect(validateRegister(base)).toEqual({});
    expect(validateRegister({ ...base, confirm: "otra" })).toEqual({ confirm: "password_mismatch" });
    expect(validateRegister({ ...base, acceptTerms: false, confirmAge: false })).toEqual({
      acceptTerms: "required",
      confirmAge: "required",
    });
    expect(validateRegister({ ...base, name: " ", phone: "123", email: "" })).toMatchObject({
      name: "required",
      phone: "invalid_phone",
      email: "required",
    });
  });

  it("valida el reporte según el tipo", () => {
    const base = { kind: "lost" as const, name: "Max", species: "dog", description: "", photos: ["a"], hasLocation: true };
    expect(hasErrors(validateReport(base))).toBe(false);
    expect(validateReport({ ...base, name: "" })).toEqual({ name: "required" });
    expect(validateReport({ ...base, kind: "found", name: "" })).toEqual({});
    expect(validateReport({ ...base, photos: [], hasLocation: false, species: null })).toEqual({
      photos: "photo_required",
      hasLocation: "location_required",
      species: "required",
    });
    expect(validateReport({ ...base, photos: ["1", "2", "3", "4", "5", "6"], description: "x".repeat(501) })).toEqual({
      photos: "too_many_photos",
      description: "too_long",
    });
  });
});

describe("privacy", () => {
  it("muestra solo nombre corto e inicial", () => {
    expect(shortName("Valentina Arango Pérez")).toBe("Valentina A.");
    expect(shortName("  Cher ")).toBe("Cher");
    expect(shortName("")).toBe("");
    expect(initials("valentina arango")).toBe("VA");
  });

  it("enmascara teléfono y correo", () => {
    expect(maskPhone("+573001234567")).toBe("+57 300 *** **67");
    expect(maskPhone("+1555")).toBe("***");
    expect(maskEmail("tomas.posada@gmail.com")).toBe("to••••••••••@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
    expect(maskEmail("sin-arroba")).toBe("***");
  });
});

describe("rules", () => {
  it("permite 2 reportes por día en ventana móvil y calcula cuándo se libera", () => {
    expect(publishAllowance([], NOW)).toEqual({ allowed: true });
    expect(publishAllowance([hoursAgo(30), hoursAgo(25)], NOW)).toEqual({ allowed: true });
    expect(publishAllowance([hoursAgo(5)], NOW)).toEqual({ allowed: true });
    const blocked = publishAllowance([hoursAgo(5), hoursAgo(2)], NOW);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAt.toISOString()).toBe(new Date(NOW.getTime() + 19 * 3_600_000).toISOString());
  });

  it("nombra el grupo de caso según el tipo", () => {
    expect(caseGroupTitle({ kind: "lost", name: "Max" })).toEqual({ key: "lost", name: "Max" });
    expect(caseGroupTitle({ kind: "found", name: "Luna" })).toEqual({ key: "found" });
  });

  it("encuentra coincidencias dentro del círculo de vida, de la misma especie y fecha compatible", () => {
    const lost = pet({ id: "lost", size: "large", sex: "male", breed: "Golden" });
    const near = pet({ id: "near", kind: "found", lastSeenAt: hoursAgo(0.5), breed: "golden" });
    const otherSpecies = pet({ id: "cat", kind: "found", species: "cat" });
    const far = pet({ id: "far", kind: "found", location: { latitude: 7.5, longitude: -75.5 } });
    const before = pet({ id: "before", kind: "found", lastSeenAt: hoursAgo(10) });
    const closed = pet({ id: "closed", kind: "found", state: "reunited" });
    const matches = findPossibleMatches(lost, [lost, near, otherSpecies, far, before, closed], NOW);
    expect(matches.map((m) => m.pet.id)).toEqual(["near"]);
    expect(matches[0]?.score).toBeGreaterThan(1);
    // Simétrico: desde la encontrada aparece la perdida.
    expect(findPossibleMatches(near, [lost], NOW).map((m) => m.pet.id)).toEqual(["lost"]);
  });

  it("no inventa estadísticas con pocos casos", () => {
    expect(impactStats([pet({})], NOW)).toBeNull();
  });

  it("calcula la métrica principal: reencuentros dentro de 14 días", () => {
    const pets = [
      pet({ state: "reunited", createdAt: hoursAgo(24 * 10), reunitedAt: hoursAgo(24 * 9) }),
      pet({ state: "reunited", createdAt: hoursAgo(24 * 40), reunitedAt: hoursAgo(24 * 20) }),
      pet({ createdAt: hoursAgo(24 * 20) }),
      pet({ createdAt: hoursAgo(2) }),
      pet({ kind: "found", createdAt: hoursAgo(2) }),
    ];
    const stats = impactStats(pets, NOW);
    expect(stats).toEqual({ reunited: 2, reportsThisMonth: 4, activeCases: 3, reunitedWithin14DaysPct: 33 });
  });

  it("agrupa pines cercanos y colorea por mayoría", () => {
    const region = { latitudeDelta: 0.07, longitudeDelta: 0.07 };
    const pets = [
      pet({ id: "a" }),
      pet({ id: "b", location: { latitude: 6.245, longitude: -75.5913 } }),
      pet({ id: "c", kind: "found", location: { latitude: 6.2451, longitude: -75.5911 } }),
      pet({ id: "solo", location: { latitude: 6.3, longitude: -75.5 } }),
    ];
    const clusters = clusterPets(pets, region);
    const group = clusters.find((c) => c.pets.length === 3);
    expect(group?.majority).toBe("lost");
    expect(group?.id.startsWith("cluster:")).toBe(true);
    expect(clusters.find((c) => c.id === "solo")?.pets).toHaveLength(1);
    expect(clusterPets([pet({ id: "x" }), pet({ id: "y", kind: "found" })], region)[0]?.majority).toBe("mixed");
  });
});
