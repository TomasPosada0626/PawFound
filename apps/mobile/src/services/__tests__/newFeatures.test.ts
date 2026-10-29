import { messagePreview } from "@/features/messages";

import type { NewReportInput } from "../backendTypes";
import { MockBackend } from "../mockBackend";
import { createSeed } from "../seed";

let clock = new Date("2026-10-27T12:00:00Z");

function makeBackend() {
  clock = new Date("2026-10-27T12:00:00Z");
  const { state, credentials } = createSeed(clock);
  return new MockBackend(state, { now: () => clock, credentials });
}

const ESTADIO = { latitude: 6.2532, longitude: -75.5889 };
const t = (key: string) => (key === "chat.photo" ? "📷 Foto" : key === "common.you" ? "Tú" : key);

const foundDog = (extra: Partial<NewReportInput> = {}): NewReportInput => ({
  kind: "found",
  species: "dog",
  sex: "male",
  age: "adult",
  size: "medium",
  color: "Negro y blanco",
  description: "Lo encontré asustado cerca del estadio.",
  photos: [],
  traumaticEvent: false,
  shyOrIndoor: false,
  lastSeenAt: clock.toISOString(),
  location: ESTADIO,
  zone: "Estadio, Medellín",
  reward: false,
  ...extra,
});

const lostDog = (): NewReportInput => ({ ...foundDog(), kind: "lost", name: "Kira" });

describe("fotos en el chat", () => {
  it("envía una foto sola o con texto, en DM y en grupos", async () => {
    const b = makeBackend();
    b.restoreSession("u_valentina");
    const photo = { uri: "file:///foto.jpg", width: 1200, height: 900 };
    await b.sendMessage("dm_maria", "", "es", photo);
    const last = b.getSnapshot().messages.at(-1);
    expect(last).toMatchObject({ threadId: "dm_maria", text: "", photo });
    expect(messagePreview(last, undefined, "u_valentina", t as never)).toBe("Tú: 📷 Foto");

    const group = b
      .getSnapshot()
      .threads.find((th) => th.kind === "group" && th.memberIds.includes("u_valentina") && !th.archived);
    await b.sendMessage(group!.id, "¿Es este?", "es", photo);
    expect(b.getSnapshot().messages.at(-1)).toMatchObject({ text: "¿Es este?", photo });

    // Sin texto ni foto no se envía nada.
    const count = b.getSnapshot().messages.length;
    await b.sendMessage("dm_maria", "   ", "es");
    expect(b.getSnapshot().messages).toHaveLength(count);
  });
});

describe("¿Es tu mascota?", () => {
  it("una encontrada parecida a Coco le avisa a su familia, con la mascota propia enlazada", async () => {
    const b = makeBackend();
    b.restoreSession("u_carlos");
    const found = await b.createReport(foundDog());
    const alerts = b.getSnapshot().notifications.filter((n) => n.kind === "owned_match");
    expect(alerts).toEqual([expect.objectContaining({ userId: "u_valentina", petId: found.id, ownedPetId: "own_coco" })]);
  });

  it("no avisa si la familia apagó 'encontradas cerca', si no se parece o si ya tiene reporte activo", async () => {
    const b = makeBackend();
    b.restoreSession("u_valentina");
    await b.updateNotificationPrefs({ foundNearby: false });
    b.restoreSession("u_carlos");
    await b.createReport(foundDog());
    expect(b.getSnapshot().notifications.some((n) => n.kind === "owned_match")).toBe(false);

    const other = makeBackend();
    other.restoreSession("u_carlos");
    await other.createReport(foundDog({ color: "Café", sex: "female" }));
    // Rocky (husky grande, gris) tiene un reporte de pérdida activo: recibe la coincidencia normal.
    await other.createReport(foundDog({ size: "large", color: "gris", breed: "Husky Siberiano" }));
    expect(other.getSnapshot().notifications.filter((n) => n.kind === "owned_match")).toEqual([]);
  });

  it("quien reporta nunca recibe la alerta de su propia mascota", async () => {
    const b = makeBackend();
    b.restoreSession("u_valentina");
    await b.createReport(foundDog());
    expect(b.getSnapshot().notifications.some((n) => n.kind === "owned_match")).toBe(false);
  });
});

describe("cierre del caso", () => {
  it("avisa a quienes compartieron el caso, para que quiten la historia de Destacadas", async () => {
    const b = makeBackend();
    b.restoreSession("u_carlos");
    const pet = await b.createReport(lostDog());
    b.restoreSession("u_emily");
    await b.sharePet(pet.id);
    b.restoreSession("u_carlos");
    await b.markReunited(pet.id);
    const closed = b.getSnapshot().notifications.filter((n) => n.kind === "case_closed" && n.petId === pet.id);
    expect(closed.map((n) => n.userId)).toEqual(["u_emily"]);
  });
});
