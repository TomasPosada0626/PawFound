import { approximateLocation } from "@/domain/geo";
import { MAX_ALERTS_PER_DAY } from "@/domain/alerts";

import { BackendError, type NewReportInput } from "../backendTypes";
import { DEMO_CODE, MAX_HELPERS, MESSAGES_PER_MINUTE, MockBackend } from "../mockBackend";
import { createSeed, DEMO_EMAIL, DEMO_PASSWORD } from "../seed";
import { reunionHelperCandidates, userBadgeProgress } from "../selectors";

let clock = new Date("2026-10-27T12:00:00Z");
const advance = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

function makeBackend() {
  clock = new Date("2026-10-27T12:00:00Z");
  const { state, credentials } = createSeed(clock);
  return new MockBackend(state, { now: () => clock, credentials });
}

const ESTADIO = { latitude: 6.2532, longitude: -75.5889 };
const ENVIGADO = { latitude: 6.1721, longitude: -75.5873 };
/** Zona de alertas de la cuenta demo. */
const LAURELES = { latitude: 6.2449, longitude: -75.5912 };

const lostReport = (extra: Partial<NewReportInput> = {}): NewReportInput => ({
  kind: "lost",
  name: "Kira",
  species: "dog",
  sex: "female",
  age: "adult",
  size: "medium",
  description: "Perrita mestiza, muy asustadiza.",
  photos: ["file:///kira.jpg"],
  traumaticEvent: false,
  shyOrIndoor: false,
  lastSeenAt: clock.toISOString(),
  location: ESTADIO,
  zone: "Estadio, Medellín",
  reward: false,
  ...extra,
});

/** Otra cuenta verificada que publica un reporte. */
async function asNewVerifiedUser(backend: MockBackend, email = "kira@x.co", phone = "3105550000") {
  await backend.logout();
  await backend.register({ name: "Camila Torres", email, phone, password: "Clave1234" });
  await backend.verifyCode(DEMO_CODE);
  return backend.currentUser!;
}

const angelAlertsFor = (backend: MockBackend, userId: string) =>
  backend.getSnapshot().notifications.filter((n) => n.userId === userId && n.kind === "angel_alert");

describe("Alerta Ángel (notificación push, no SMS)", () => {
  it("al publicar una perdida avisa a los celulares dentro del círculo inicial", async () => {
    const backend = makeBackend();
    await asNewVerifiedUser(backend);
    // Perro tranquilo cerca del estadio: círculo inicial de 500 m.
    const pet = await backend.createReport(lostReport());
    expect(angelAlertsFor(backend, "u_carlos").filter((n) => n.petId === pet.id)).toHaveLength(1);
    expect(angelAlertsFor(backend, "u_valentina").some((n) => n.petId === pet.id)).toBe(false);
  });

  it("no avisa fuera de la zona, ni si la persona desactivó las alertas o quitó su zona", async () => {
    const backend = makeBackend();
    await asNewVerifiedUser(backend);
    const far = await backend.createReport(lostReport({ location: ENVIGADO, zone: "Envigado" }));
    expect(angelAlertsFor(backend, "u_valentina").some((n) => n.petId === far.id)).toBe(false);

    await backend.logout();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await backend.updateNotificationPrefs({ angelAlerts: false });
    await asNewVerifiedUser(backend, "otra@x.co", "3105550001");
    const off = await backend.createReport(lostReport({ location: LAURELES }));
    expect(angelAlertsFor(backend, "u_valentina").some((n) => n.petId === off.id)).toBe(false);
  });

  it("revocar la zona detiene las alertas de forma verificable", async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await backend.setAlertZone(null);
    expect(backend.getSnapshot().alertZones.u_valentina).toBeUndefined();
    await asNewVerifiedUser(backend);
    const pet = await backend.createReport(lostReport({ location: LAURELES }));
    expect(angelAlertsFor(backend, "u_valentina").some((n) => n.petId === pet.id)).toBe(false);
  });

  it("guarda la zona aproximada (celda de 250 m), nunca el punto exacto", async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    const exact = { latitude: 6.24512345, longitude: -75.59187654 };
    await backend.setAlertZone({ location: exact, zone: "Laureles" });
    expect(backend.getSnapshot().alertZones.u_valentina).toEqual({ location: approximateLocation(exact), zone: "Laureles" });
  });

  it(`nunca más de ${MAX_ALERTS_PER_DAY} alertas por persona en 24 horas`, async () => {
    const backend = makeBackend();
    // La cuenta demo ya recibió 1 Alerta Ángel (Max) en las últimas 24 h.
    for (let i = 0; i < MAX_ALERTS_PER_DAY; i++) {
      await asNewVerifiedUser(backend, `p${i}@x.co`, `310555000${i}`);
      await backend.createReport(lostReport({ name: `Perrito ${i}`, location: LAURELES }));
    }
    expect(angelAlertsFor(backend, "u_valentina")).toHaveLength(MAX_ALERTS_PER_DAY);
  });

  it("a medida que el círculo crece, la alerta llega a más celulares (una vez por persona)", async () => {
    const backend = makeBackend();
    await asNewVerifiedUser(backend);
    // Perro asustado: círculo inicial de 1 km. Valentina (Laureles, ~1 km) entra al publicar;
    // Laura (Belén, ~3 km) recién cuando el círculo crece.
    const pet = await backend.createReport(lostReport({ traumaticEvent: true }));
    const alerted = (userId: string) =>
      backend.getSnapshot().notifications.filter((n) => n.userId === userId && n.petId === pet.id);
    expect(alerted("u_carlos").map((n) => n.kind)).toEqual(["angel_alert"]);
    expect(alerted("u_laura")).toHaveLength(0);
    backend.runScheduledJobs();
    expect(alerted("u_laura")).toHaveLength(0);
    advance(6 * 60);
    expect(backend.runScheduledJobs()).toBeGreaterThan(0);
    expect(alerted("u_laura").map((n) => n.kind)).toEqual(["life_circle"]);
    backend.runScheduledJobs();
    expect(alerted("u_laura")).toHaveLength(1);
    expect(alerted("u_carlos")).toHaveLength(1);
  });

  it("moderación puede limitar temporalmente a quien no respeta las normas; antispam por minuto", async () => {
    const backend = makeBackend();
    backend.applyModerationMute("u_valentina", 24);
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await expect(backend.sendMessage("dm_maria", "Hola")).rejects.toMatchObject({ code: "muted" });
    advance(25 * 60);
    await backend.sendMessage("dm_maria", "Hola de nuevo");
    for (let i = 0; i < MESSAGES_PER_MINUTE - 1; i++) await backend.sendMessage("dm_maria", `Mensaje ${i}`);
    await expect(backend.sendMessage("dm_maria", "Uno más")).rejects.toMatchObject({ code: "rate_limited" });
    expect(() => backend.applyModerationMute("u_nadie", 1)).toThrow(BackendError);
  });
});

describe("Ángel de patas", () => {
  it("lista solo a quienes participaron en el caso, sin la familia", () => {
    const backend = makeBackend();
    const candidates = reunionHelperCandidates(backend.getSnapshot(), "rocky");
    expect(candidates.map((c) => c.userId).sort()).toEqual(["u_daniel", "u_sofia"]);
    expect(candidates.every((c) => c.reasons.includes("group"))).toBe(true);
    expect(reunionHelperCandidates(backend.getSnapshot(), "no-existe")).toEqual([]);
  });

  it("la familia agradece al cerrar: el ayudante recibe aviso e insignia; no se puede regalar a cualquiera", async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await backend.markReunited("rocky", ["u_daniel", "u_carlos", "u_valentina"]);
    const rocky = backend.getPet("rocky")!;
    expect(rocky.state).toBe("reunited");
    expect(rocky.helperIds).toEqual(["u_daniel"]);
    const notes = backend.getSnapshot().notifications.filter((n) => n.petId === "rocky");
    expect(notes.find((n) => n.userId === "u_daniel")?.kind).toBe("thanked");
    expect(notes.find((n) => n.userId === "u_sofia")?.kind).toBe("case_closed");
    const angel = userBadgeProgress(backend.getSnapshot(), "u_daniel").find((b) => b.id === "paw_angel");
    expect(angel?.tier).toBe(1);
    await expect(backend.markReunited("rocky")).rejects.toBeInstanceOf(BackendError);
  });

  it(`limita a ${MAX_HELPERS} personas agradecidas`, async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    const state = backend.getSnapshot();
    const extra = ["u_maria", "u_ana", "u_carlos", "u_laura", "u_emily"];
    // Todos escriben en el grupo de Rocky para ser candidatos válidos.
    (backend as unknown as { state: typeof state }).state = {
      ...state,
      messages: [
        ...state.messages,
        ...extra.map((id, i) => ({
          id: `m_x${i}`,
          threadId: "grp_rocky",
          authorId: id,
          authorShortName: id,
          text: "¡Yo ayudo!",
          at: clock.toISOString(),
          kind: "text" as const,
        })),
      ],
    };
    await backend.markReunited("rocky", ["u_daniel", "u_sofia", ...extra]);
    expect(backend.getPet("rocky")?.helperIds).toHaveLength(MAX_HELPERS);
  });

  it("si moderación retira un reporte, deja de contar para las insignias", async () => {
    const backend = makeBackend();
    const before = userBadgeProgress(backend.getSnapshot(), "u_valentina").find((b) => b.id === "paw_angel");
    expect(before?.tier).toBe(1);
    backend.applyModerationRemoval("canela");
    const after = userBadgeProgress(backend.getSnapshot(), "u_valentina").find((b) => b.id === "paw_angel");
    expect(after?.tier).toBe(0);
    backend.applyModerationRemoval("rocky");
    expect(backend.getPet("rocky")?.state).toBe("archived");
  });

  it("compartir cuenta casos distintos para la insignia Megáfono", async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await backend.sharePet("max");
    await backend.sharePet("toby");
    await backend.sharePet("toby");
    expect(backend.getSnapshot().shareLog.u_valentina).toEqual(["max", "collie", "toby"]);
    await backend.logout();
    await backend.sharePet("toby");
    expect(backend.getPet("toby")?.shareCount).toBe(22);
  });

  it("un avistamiento en un caso ajeno cuenta para Ojos atentos", async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await backend.addSighting("max", { at: clock.toISOString(), location: ESTADIO, zone: "Estadio" });
    const eyes = userBadgeProgress(backend.getSnapshot(), "u_valentina").find((b) => b.id === "eyes");
    expect(eyes).toMatchObject({ count: 1, tier: 1, next: 5 });
  });
});

describe("Mis mascotas", () => {
  const profile = {
    name: " Nala ",
    species: "cat" as const,
    sex: "female" as const,
    age: "young" as const,
    size: "small" as const,
    description: "Gata gris, tímida.",
    photos: ["file:///nala.jpg"],
    shyOrIndoor: true,
    breed: "  ",
  };

  it("crea, edita y elimina perfiles propios; exige sesión y nombre", async () => {
    const backend = makeBackend();
    await expect(backend.saveOwnedPet(profile)).rejects.toBeInstanceOf(BackendError);
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    await expect(backend.saveOwnedPet({ ...profile, name: "  " })).rejects.toBeInstanceOf(BackendError);
    const nala = await backend.saveOwnedPet(profile);
    expect(nala).toMatchObject({ name: "Nala", breed: undefined, ownerId: "u_valentina" });
    const edited = await backend.saveOwnedPet({ ...profile, name: "Nala Luna" }, nala.id);
    expect(edited.name).toBe("Nala Luna");
    await expect(backend.saveOwnedPet(profile, "own_x")).rejects.toBeInstanceOf(BackendError);
    await backend.deleteOwnedPet(nala.id);
    await backend.deleteOwnedPet("own_x");
    expect(backend.getSnapshot().ownedPets.map((p) => p.id)).toEqual(["own_rocky", "own_coco"]);
  });

  it("nadie edita ni borra el perfil de otra cuenta", async () => {
    const backend = makeBackend();
    await asNewVerifiedUser(backend);
    await expect(backend.saveOwnedPet(profile, "own_rocky")).rejects.toBeInstanceOf(BackendError);
    await expect(backend.deleteOwnedPet("own_rocky")).rejects.toBeInstanceOf(BackendError);
  });

  it("publicar desde un perfil lo enlaza al caso; exportar y borrar la cuenta lo incluyen", async () => {
    const backend = makeBackend();
    await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
    const nala = await backend.saveOwnedPet(profile);
    const pet = await backend.createReport(lostReport({ name: "Nala", ownedPetId: nala.id }));
    expect(backend.getSnapshot().ownedPets.find((p) => p.id === nala.id)?.lastCaseId).toBe(pet.id);
    const exported = JSON.parse(await backend.exportData()) as { ownedPets: unknown[]; alertZone: unknown };
    expect(exported.ownedPets).toHaveLength(3);
    expect(exported.alertZone).not.toBeNull();
    await backend.deleteAccount();
    const after = backend.getSnapshot();
    expect(after.ownedPets).toHaveLength(0);
    expect(after.alertZones.u_valentina).toBeUndefined();
    expect(after.shareLog.u_valentina).toBeUndefined();
  });
});
