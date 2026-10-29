import { alertAudience, alertsGap, isQuietTime, MAX_ALERTS_PER_DAY, type AlertCandidate } from "../alerts";
import { BADGE_ORDER, badgeProgress, newlyEarned, tierFor, tiersOf, type BadgeFacts } from "../badges";
import { memberDays, mightBeOffensive } from "../moderation";
import type { PetCase } from "../types";

const now = new Date("2026-10-27T12:00:00Z");
const LAURELES = { latitude: 6.2449, longitude: -75.5912 };

const pet = (extra: Partial<PetCase> = {}): PetCase => ({
  id: "p1",
  kind: "lost",
  state: "active",
  name: "Max",
  species: "dog",
  sex: "male",
  age: "adult",
  size: "medium",
  description: "",
  photos: [],
  traumaticEvent: false,
  shyOrIndoor: false,
  lastSeenAt: now.toISOString(),
  location: LAURELES,
  zone: "Laureles",
  reward: false,
  ownerId: "owner",
  ownerShortName: "Ana R.",
  createdAt: now.toISOString(),
  sightings: [],
  shareCount: 0,
  groupId: "g1",
  ...extra,
});

/** Punto a ~`km` kilómetros al norte de Laureles. */
const north = (km: number) => ({ latitude: LAURELES.latitude + km / 111.32, longitude: LAURELES.longitude });

const candidate = (extra: Partial<AlertCandidate> = {}): AlertCandidate => ({
  userId: "u1",
  zone: { location: north(0.8), zone: "Estadio" },
  prefs: { angelAlerts: true },
  alertsLast24h: 0,
  alreadyAlerted: false,
  ...extra,
});

describe("Alerta Ángel", () => {
  // Perro asustado: círculo de 1 km al publicar que crece con el tiempo.
  const panicDog = pet({ traumaticEvent: true });

  it("al publicar, llega a los celulares dentro del círculo inicial", () => {
    expect(alertAudience(panicDog, [candidate()], now)).toEqual(["u1"]);
    expect(alertAudience(panicDog, [candidate({ zone: { location: north(3), zone: "Robledo" } })], now)).toEqual([]);
  });

  it("a medida que el círculo crece, llega a celulares más lejanos", () => {
    const far = candidate({ zone: { location: north(3), zone: "Robledo" } });
    const later = new Date(now.getTime() + 6 * 3_600_000);
    expect(alertAudience(panicDog, [far], later)).toEqual(["u1"]);
    // Un gato tímido casi no se aleja: su círculo no llega tan lejos.
    expect(alertAudience(pet({ species: "cat", shyOrIndoor: true }), [far], later)).toEqual([]);
  });

  it("respeta consentimiento, límite diario y una sola alerta por caso", () => {
    expect(alertAudience(panicDog, [candidate({ prefs: { angelAlerts: false } })], now)).toEqual([]);
    expect(alertAudience(panicDog, [candidate({ alertsLast24h: MAX_ALERTS_PER_DAY })], now)).toEqual([]);
    expect(alertAudience(panicDog, [candidate({ alreadyAlerted: true })], now)).toEqual([]);
    expect(alertAudience(panicDog, [candidate({ userId: "owner" })], now)).toEqual([]);
  });

  it("no aplica a encontradas ni a casos cerrados", () => {
    expect(alertAudience(pet({ kind: "found" }), [candidate()], now)).toEqual([]);
    expect(alertAudience(pet({ state: "reunited" }), [candidate()], now)).toEqual([]);
  });

  it("modo descanso: rangos normales y nocturnos", () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m);
    const night = { quietHours: true, quietFrom: "22:00", quietTo: "07:00" };
    expect(isQuietTime(night, at(23))).toBe(true);
    expect(isQuietTime(night, at(6, 59))).toBe(true);
    expect(isQuietTime(night, at(7))).toBe(false);
    expect(isQuietTime(night, at(12))).toBe(false);
    const day = { quietHours: true, quietFrom: "13:00", quietTo: "15:00" };
    expect(isQuietTime(day, at(14))).toBe(true);
    expect(isQuietTime(day, at(15))).toBe(false);
    expect(isQuietTime({ ...night, quietHours: false }, at(23))).toBe(false);
    expect(isQuietTime({ quietHours: true, quietFrom: "09:00", quietTo: "09:00" }, at(9))).toBe(false);
  });
});

describe("convivencia", () => {
  it("detecta posibles groserías sin tildes ni mayúsculas, sin falsos positivos por subcadena", () => {
    expect(mightBeOffensive("Eres un IDIOTA")).toBe(true);
    expect(mightBeOffensive("qué estúpido")).toBe(true);
    expect(mightBeOffensive("you idiot!")).toBe(true);
    expect(mightBeOffensive("Lo vi cerca del parque, iba asustado")).toBe(false);
    expect(mightBeOffensive("computadora")).toBe(false);
  });

  it("cuenta días completos desde el registro", () => {
    expect(memberDays("2026-10-27T00:00:00Z", now)).toBe(0);
    expect(memberDays("2026-07-29T12:00:00Z", now)).toBe(90);
    expect(memberDays("2026-11-01T00:00:00Z", now)).toBe(0);
  });
});

describe("insignias", () => {
  const zero = Object.fromEntries(BADGE_ORDER.map((id) => [id, 0])) as BadgeFacts;

  it("calcula el nivel por umbrales (bronce, plata, oro)", () => {
    expect(tierFor(0, [1, 5, 10])).toBe(0);
    expect(tierFor(1, [1, 5, 10])).toBe(1);
    expect(tierFor(7, [1, 5, 10])).toBe(2);
    expect(tierFor(10, [1, 5, 10])).toBe(3);
  });

  it("informa la meta del siguiente nivel y el máximo", () => {
    const progress = badgeProgress({ ...zero, reporter: 6, verified: 1, community: 2 });
    expect(progress.find((p) => p.id === "reporter")).toMatchObject({ tier: 2, next: 10, maxTier: 3 });
    expect(progress.find((p) => p.id === "verified")).toMatchObject({ tier: 1, next: null, maxTier: 1 });
    expect(progress.find((p) => p.id === "community")).toMatchObject({ tier: 0, next: 3 });
    expect(progress.map((p) => p.id)).toEqual(BADGE_ORDER);
  });

  it("solo celebra niveles nuevos respecto a lo ya visto", () => {
    const before = badgeProgress({ ...zero, verified: 1, reporter: 4 });
    const after = badgeProgress({ ...zero, verified: 1, reporter: 5, eyes: 1 });
    expect(newlyEarned(tiersOf(before), after)).toEqual([
      { id: "reporter", tier: 2 },
      { id: "eyes", tier: 1 },
    ]);
    expect(newlyEarned(tiersOf(after), after)).toEqual([]);
  });
});

describe("alertsGap: por qué no llegarían las Alertas Ángel", () => {
  const on = { push: true, angelAlerts: true };
  it("señala lo primero que hay que resolver", () => {
    expect(alertsGap("denied", on, true)).toBe("permission");
    expect(alertsGap("undetermined", on, true)).toBe("permission");
    expect(alertsGap("granted", { ...on, push: false }, true)).toBe("push");
    expect(alertsGap("granted", { ...on, angelAlerts: false }, true)).toBe("angel");
    expect(alertsGap("granted", on, false)).toBe("zone");
    expect(alertsGap("granted", on, true)).toBeNull();
  });
});
