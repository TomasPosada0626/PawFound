import { distanceMeters } from "@/domain/geo";

import { BackendError, type NewReportInput } from "../backendTypes";
import { DEMO_CODE, MockBackend, RESEND_COOLDOWN_S } from "../mockBackend";
import { createSeed, DEMO_EMAIL, DEMO_PASSWORD } from "../seed";
import {
  counterpart,
  lastMessage,
  threadMessages,
  totalUnread,
  unreadCount,
  userActivity,
  userBadgeProgress,
  userNotifications,
  userStats,
  followInfoOf,
  networkOf,
  ratingOf,
  shelterSummaryOf,
} from "../selectors";

let clock = new Date("2026-10-27T12:00:00Z");
const advance = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

const signInAs = (backend: { restoreSession: (id: string) => Promise<boolean> }, id: string) => backend.restoreSession(id);

function makeBackend(translator?: (text: string, from: "es" | "en", to: "es" | "en") => string | null) {
  clock = new Date("2026-10-27T12:00:00Z");
  const { state, credentials } = createSeed(clock);
  return new MockBackend(state, { now: () => clock, credentials, translator });
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(BackendError);
  await promise.catch((e: BackendError) => expect(e.code).toBe(code));
};

const report = (over: Partial<NewReportInput> = {}): NewReportInput => ({
  kind: "lost",
  name: "Kira",
  species: "dog",
  sex: "female",
  age: "adult",
  size: "medium",
  description: "Muy dulce",
  photos: ["file:///kira.jpg"],
  traumaticEvent: true,
  shyOrIndoor: false,
  lastSeenAt: clock.toISOString(),
  location: { latitude: 6.24493, longitude: -75.59121 },
  zone: "Laureles, Medellín",
  reward: false,
  ...over,
});

async function loginDemo(backend: MockBackend) {
  await backend.login(DEMO_EMAIL, DEMO_PASSWORD);
}

describe("autenticación", () => {
  it("no revela si el correo existe: mismo error para correo y contraseña", async () => {
    const backend = makeBackend();
    await expectCode(backend.login("nadie@x.co", "x"), "invalid_credentials");
    await expectCode(backend.login(DEMO_EMAIL, "mala"), "invalid_credentials");
    await expect(backend.login(DEMO_EMAIL.toUpperCase(), DEMO_PASSWORD)).resolves.toEqual({ needsVerification: false });
    expect(backend.currentUser?.id).toBe("u_valentina");
  });

  it("registra, envía código y otorga la insignia azul al verificar", async () => {
    const backend = makeBackend();
    await backend.register({ name: "Ana Gómez", email: "ana@x.co", username: "ana_g", password: "Clave1234" });
    const user = backend.currentUser;
    expect(user?.verified).toBe(false);
    expect(user?.username).toBe("ana_g");
    expect(backend.getSnapshot().verification?.email).toBe("ana@x.co");
    await backend.verifyCode(DEMO_CODE);
    expect(backend.currentUser?.verified).toBe(true);
    expect(userBadgeProgress(backend.getSnapshot(), user!.id).find((b) => b.id === "verified")?.tier).toBe(1);
  });

  it("rechaza correos y nombres de usuario repetidos o con caracteres especiales", async () => {
    const backend = makeBackend();
    await expectCode(
      backend.register({ name: "X Y", email: DEMO_EMAIL, username: "nuevo_1", password: "Clave1234" }),
      "email_taken",
    );
    await expectCode(
      backend.register({ name: "X Y", email: "x@x.co", username: "valentina", password: "Clave1234" }),
      "username_taken",
    );
    await expectCode(
      backend.register({ name: "X Y", email: "y@x.co", username: "a b", password: "Clave1234" }),
      "invalid_username",
    );
    await expectCode(
      backend.register({ name: "X Y", email: "z@x.co", username: "@valen", password: "Clave1234" }),
      "invalid_username",
    );
  });

  it("bloquea 5 minutos tras 5 códigos incorrectos y luego vence a los 10 minutos", async () => {
    const backend = makeBackend();
    await backend.register({ name: "Ana Gómez", email: "ana@x.co", username: "ana_g", password: "Clave1234" });
    for (let i = 1; i <= 4; i++) {
      await backend.verifyCode("000000").catch((e: BackendError) => {
        expect(e.code).toBe("wrong_code");
        expect(e.params.count).toBe(5 - i);
      });
    }
    await expectCode(backend.verifyCode("000000"), "locked");
    await expectCode(backend.verifyCode(DEMO_CODE), "locked");
    advance(6);
    await expect(backend.verifyCode(DEMO_CODE)).resolves.toBeUndefined();

    await backend.logout();
    await backend.register({ name: "Luis Díaz", email: "luis@x.co", username: "luis_d", password: "Clave1234" });
    advance(11);
    await expectCode(backend.verifyCode(DEMO_CODE), "expired");
  });

  it("respeta la espera para reenviar el código", async () => {
    const backend = makeBackend();
    await backend.register({ name: "Ana Gómez", email: "ana@x.co", username: "ana_g", password: "Clave1234" });
    expect(backend.secondsUntilResend()).toBe(RESEND_COOLDOWN_S);
    await expectCode(backend.resendCode(), "not_allowed");
    advance(1);
    expect(backend.secondsUntilResend()).toBe(0);
    await expect(backend.resendCode()).resolves.toBeUndefined();
  });

  it("restaura la sesión solo si la cuenta existe", async () => {
    const backend = makeBackend();
    await expect(backend.restoreSession("u_inexistente")).resolves.toBe(false);
    await expect(backend.restoreSession("u_valentina")).resolves.toBe(true);
  });
});

describe("reportes", () => {
  it("aproxima la ubicación, crea el grupo de caso y aplica el límite diario", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    const input = report();
    const pet = await backend.createReport(input);
    expect(pet.location).not.toEqual(input.location);
    expect(distanceMeters(pet.location, input.location)).toBeLessThan(250);
    expect(pet.ownerShortName).toBe("Valentina A.");
    const group = backend.getSnapshot().threads.find((t) => t.id === pet.groupId);
    expect(group?.memberIds).toEqual(["u_valentina"]);
    expect(lastMessage(backend.getSnapshot(), pet.groupId)?.text).toBe("created");

    // La cuenta demo ya publicó hace 2 días; hoy puede 2 más y el tercero se bloquea.
    await backend.createReport(report({ name: "Otra" }));
    await expectCode(backend.createReport(report({ name: "Tercera" })), "rate_limited");
    advance(24 * 60 + 1);
    await expect(backend.createReport(report({ name: "Mañana" }))).resolves.toBeTruthy();
  });

  it("descarta campos que no aplican al tipo de reporte", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    const found = await backend.createReport(
      report({
        kind: "found",
        name: "",
        reward: true,
        traumaticEvent: true,
        foundSearchRadius: 2000,
        foundCondition: "scared",
        foundCustody: "vet",
      }),
    );
    expect(found).toMatchObject({
      kind: "found",
      name: undefined,
      reward: false,
      traumaticEvent: false,
      foundSearchRadius: 2000,
      foundCustody: "vet",
    });
  });

  it("avisa a la familia de una perdida cuando aparece una posible coincidencia", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await backend.createReport(
      report({
        kind: "found",
        species: "dog",
        size: "large",
        location: { latitude: 6.2449, longitude: -75.5912 },
        lastSeenAt: clock.toISOString(),
      }),
    );
    const maria = userNotifications(backend.getSnapshot(), "u_maria");
    expect(maria.some((n) => n.kind === "possible_match")).toBe(true);
  });

  it("un avistamiento más reciente mueve el último punto y notifica a la familia", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    const before = backend.getPet("max")!;
    advance(30);
    await backend.addSighting("max", {
      at: clock.toISOString(),
      location: { latitude: 6.2532, longitude: -75.5889 },
      zone: "Estadio",
      note: " iba rápido ",
    });
    const after = backend.getPet("max")!;
    expect(after.lastSeenAt).toBe(clock.toISOString());
    expect(after.zone).toBe("Estadio");
    expect(after.sightings[0]).toMatchObject({ zone: "Estadio", note: "iba rápido", authorShortName: "Valentina A." });
    expect(userNotifications(backend.getSnapshot(), "u_maria")[0]?.kind).toBe("sighting");
    // Uno más viejo se registra pero no retrocede el último punto.
    await backend.addSighting("max", { at: before.lastSeenAt, location: before.location, zone: "Viejo" });
    expect(backend.getPet("max")!.zone).toBe("Estadio");
  });

  it("solo la familia marca el reencuentro; archiva el grupo y avisa a los miembros", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await expectCode(backend.markReunited("max"), "not_allowed");
    await backend.markReunited("rocky");
    const state = backend.getSnapshot();
    expect(state.pets.find((p) => p.id === "rocky")?.state).toBe("reunited");
    expect(state.threads.find((t) => t.id === "grp_rocky")?.archived).toBe(true);
    expect(userNotifications(state, "u_sofia")[0]?.kind).toBe("case_closed");
    await expectCode(backend.sendMessage("grp_rocky", "hola"), "not_allowed");
    await expectCode(
      backend.addSighting("rocky", { at: clock.toISOString(), location: { latitude: 6, longitude: -75 }, zone: "x" }),
      "not_allowed",
    );
  });

  it("solo la familia elimina su publicación; sale de la lista y cierra el grupo", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await expectCode(backend.withdrawPet("max"), "not_allowed");
    await backend.withdrawPet("rocky");
    const state = backend.getSnapshot();
    expect(state.pets.some((p) => p.id === "rocky")).toBe(false);
    expect(state.threads.find((t) => t.id === "grp_rocky")?.archived).toBe(true);
    expect(state.notifications.some((n) => n.petId === "rocky")).toBe(false);
  });

  it("solo la familia muestra su celular, y al cerrar el caso se borra", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await expectCode(backend.setContactPhone("max", "3001234567"), "not_allowed");
    await expectCode(backend.setContactPhone("rocky", "123"), "invalid_phone");
    await backend.setContactPhone("rocky", "300 123 4567");
    expect(backend.getPet("rocky")?.contactPhone).toBe("+573001234567");
    await backend.setContactPhone("rocky", "");
    expect(backend.getPet("rocky")?.contactPhone).toBeUndefined();
    await backend.setContactPhone("rocky", "3001234567");
    await backend.markReunited("rocky");
    expect(backend.getPet("rocky")?.contactPhone).toBeUndefined();
  });

  it("cuenta compartidos y valida que el caso exista", async () => {
    const backend = makeBackend();
    const before = backend.getPet("max")!.shareCount;
    await backend.sharePet("max");
    expect(backend.getPet("max")!.shareCount).toBe(before + 1);
    await expectCode(backend.reportPost("no-existe"), "not_found");
    await expect(backend.reportPost("max")).resolves.toBeUndefined();
  });
});

describe("mensajería", () => {
  it("unirse a un grupo es idempotente y agrega mensaje de sistema", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    const id = await backend.joinGroup("simba");
    expect(await backend.joinGroup("simba")).toBe(id);
    expect(threadMessages(backend.getSnapshot(), id).filter((m) => m.text === "joined")).toHaveLength(1);
  });

  it("abre un DM único por pareja y respeta la privacidad del destinatario", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    expect(await backend.openDirect("max")).toBe("dm_maria");
    await expectCode(backend.openDirect("rocky"), "not_allowed");
    const dm = await backend.openDirect("simba");
    expect(
      counterpart(
        backend.getSnapshot(),
        backend.getSnapshot().threads.find((t) => t.id === dm)!,
        "u_valentina",
      )?.id,
    ).toBe("u_carlos");

    // Carlos cierra los mensajes privados: ya no se puede abrir uno nuevo con él.
    await backend.logout();
    backend.restoreSession("u_carlos");
    await backend.updatePrivacy({ whoCanMessage: "nobody" });
    backend.restoreSession("u_valentina");
    await expectCode(backend.openDirect("simba"), "cannot_message");
  });

  it("traduce una vez por idioma de los miembros y guarda el idioma original", async () => {
    const translator = jest.fn((text: string, from: string, to: string) => `[${from}→${to}] ${text}`);
    const backend = makeBackend(translator);
    await loginDemo(backend);
    await backend.sendMessage("grp_max", "  Lo vi en el parque  ", "es");
    const sent = lastMessage(backend.getSnapshot(), "grp_max");
    expect(sent).toMatchObject({ text: "Lo vi en el parque", lang: "es", translations: { en: "[es→en] Lo vi en el parque" } });
    expect(translator).toHaveBeenCalledTimes(1);
  });

  it("sin traductor (demo) no inventa traducciones", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await backend.sendMessage("grp_max", "Hola", "es");
    expect(lastMessage(backend.getSnapshot(), "grp_max")?.translations).toEqual({});
    await backend.sendMessage("grp_max", "   ", "es");
    expect(lastMessage(backend.getSnapshot(), "grp_max")?.text).toBe("Hola");
  });

  it("solo miembros escriben; leer limpia los no leídos; silenciar los excluye del contador", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await expectCode(backend.sendMessage("grp_simba", "hola"), "not_allowed");
    const state = backend.getSnapshot();
    const max = state.threads.find((t) => t.id === "grp_max")!;
    expect(unreadCount(state, max, "u_valentina")).toBeGreaterThan(0);
    const total = totalUnread(state, "u_valentina");
    await backend.toggleMute("grp_max");
    expect(totalUnread(backend.getSnapshot(), "u_valentina")).toBeLessThan(total);
    await backend.toggleMute("grp_max");
    await backend.markThreadRead("grp_max");
    const after = backend.getSnapshot();
    expect(
      unreadCount(
        after,
        after.threads.find((t) => t.id === "grp_max")!,
        "u_valentina",
      ),
    ).toBe(0);
  });

  it("marca notificaciones como leídas", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await backend.markNotificationRead("n1");
    expect(backend.getSnapshot().notifications.find((n) => n.id === "n1")?.read).toBe(true);
    await backend.markAllNotificationsRead();
    expect(userNotifications(backend.getSnapshot(), "u_valentina").every((n) => n.read)).toBe(true);
  });
});

describe("perfil, privacidad y derechos sobre los datos", () => {
  it("valida el nombre de usuario y recorta la descripción", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await expectCode(backend.updateProfile({ username: "a" }), "invalid_username");
    await expectCode(backend.updateProfile({ username: "MARIA" }), "username_taken");
    await backend.updateProfile({ username: "Vale_23", bio: "x".repeat(300) });
    expect(backend.currentUser).toMatchObject({ username: "vale_23" });
    expect(backend.currentUser?.bio).toHaveLength(150);
  });

  it("guarda preferencias; no hay bloqueos: se reporta a la persona con contexto", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    await backend.updateNotificationPrefs({ quietHours: true, quietFrom: "23:00" });
    expect(backend.notificationPrefsFor("u_valentina")).toMatchObject({ quietHours: true, quietFrom: "23:00", lostNearby: true });
    await backend.reportUser({
      userId: "u_maria",
      reason: "rude",
      threadId: "dm_maria",
      messageId: "m_seed_1",
      note: " Me insultó ",
    });
    await backend.reportUser({ userId: "u_maria", reason: "rude", threadId: "dm_maria", messageId: "m_seed_1" });
    expect(backend.getSnapshot().userReports).toEqual([
      expect.objectContaining({ reporterId: "u_valentina", reportedId: "u_maria", reason: "rude", note: "Me insultó" }),
    ]);
    await expectCode(backend.reportUser({ userId: "u_valentina", reason: "spam" }), "not_allowed");
    await expectCode(backend.reportUser({ userId: "u_nadie", reason: "spam" }), "not_allowed");
    await backend.setLanguage("en");
    expect(backend.currentUser?.lang).toBe("en");
  });

  it("exporta los datos propios (portabilidad)", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    const data = JSON.parse(await backend.exportData());
    expect(data.profile.id).toBe("u_valentina");
    expect(data.reports.every((r: { ownerId: string }) => r.ownerId === "u_valentina")).toBe(true);
  });

  it("eliminar la cuenta borra todo lo que publicó, también en lo ajeno, e impide volver a entrar", async () => {
    const backend = makeBackend();
    await loginDemo(backend);
    // Lo que hace en lo ajeno: un avistamiento, me gusta, seguir y una solicitud de PawFamily.
    await backend.addSighting("max", {
      at: clock.toISOString(),
      location: { latitude: 6.245, longitude: -75.59 },
      zone: "Laureles",
    });
    await backend.toggleProfileLike("u_daniel");
    await backend.followUser("u_daniel");
    await backend.acceptAdoptionTerms();
    await backend.applyToAdoption("ad_canela", {
      fullName: "Valentina",
      household: 2,
      neighborhood: "Laureles",
      city: "Medellín",
      hadPets: true,
      petsCount: 1,
      reason: "Tenemos patio y mucho tiempo para ella.",
    });
    const mine = await backend.createAdoption({
      name: "Toby",
      species: "dog",
      sex: "male",
      age: "young",
      size: "small",
      description: "Juguetón y sano",
      vaccinated: true,
      sterilized: false,
      photos: ["file:///toby.jpg"],
      location: { latitude: 6.24, longitude: -75.59 },
      zone: "Laureles, Medellín",
    });

    await backend.deleteAccount();
    const state = backend.getSnapshot();
    const me = "u_valentina";
    expect(state.users[me]).toBeUndefined();
    expect(state.sessionUserId).toBeNull();
    expect(state.pets.some((p) => p.id === "rocky" || p.ownerId === me)).toBe(false);
    expect(state.pets.some((p) => p.sightings.some((s) => s.authorId === me))).toBe(false);
    expect(state.threads.some((t) => t.petId === "rocky" || t.memberIds.includes(me))).toBe(false);
    expect(state.messages.some((m) => m.authorId === me)).toBe(false);
    expect(state.adoptions.some((a) => a.id === mine)).toBe(false);
    expect(state.adoptionApplications.some((a) => a.applicantId === me)).toBe(false);
    expect(state.follows.some((f) => f.followerId === me || f.followedId === me)).toBe(false);
    expect(state.profileLikes.u_daniel ?? []).not.toContain(me);
    expect(state.stories.some((s) => s.authorId === me)).toBe(false);
    await expectCode(backend.login(DEMO_EMAIL, DEMO_PASSWORD), "invalid_credentials");
  });

  it("seguir es mutuo al aceptar; los me gusta no dependen de seguirse", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_valentina");
    await expect(backend.toggleProfileLike("u_daniel")).resolves.toBe(true);
    await expect(backend.followUser("u_daniel")).resolves.toBe("pending");
    await expect(backend.followUser("u_daniel")).resolves.toBe("pending");
    await expect(backend.followUser("u_valentina")).rejects.toMatchObject({ code: "not_allowed" });
    expect(networkOf(backend.getSnapshot()).sent).toContain("u_daniel");

    await signInAs(backend, "u_daniel");
    await backend.loadNetwork();
    expect(networkOf(backend.getSnapshot()).requests).toContain("u_valentina");
    await backend.acceptFollower("u_valentina");
    expect(networkOf(backend.getSnapshot())).toMatchObject({ followers: ["u_valentina"], following: ["u_valentina"] });

    await signInAs(backend, "u_valentina");
    await backend.loadNetwork();
    expect(followInfoOf(backend.getSnapshot(), "u_daniel")).toMatchObject({ status: "accepted", followers: 1, following: 1 });
    await expect(backend.followUser("u_daniel")).resolves.toBe("accepted");

    // Eliminar es de un solo lado, se puede volver a pedir y el me gusta se mantiene.
    await signInAs(backend, "u_daniel");
    await backend.removeFollower("u_valentina");
    expect(backend.getSnapshot().profileLikes.u_daniel).toContain("u_valentina");
    await signInAs(backend, "u_valentina");
    await backend.loadNetwork();
    expect(followInfoOf(backend.getSnapshot(), "u_daniel")).toMatchObject({ status: "none", followers: 0, following: 1 });
    await expect(backend.followUser("u_daniel")).resolves.toBe("pending");
  });

  it("tres rechazos suspenden el envío de solicitudes", async () => {
    const backend = makeBackend();
    for (let i = 0; i < 3; i++) {
      await signInAs(backend, "u_valentina");
      await expect(backend.followUser("u_daniel")).resolves.toBe("pending");
      await signInAs(backend, "u_daniel");
      await backend.removeFollower("u_valentina");
    }
    await signInAs(backend, "u_valentina");
    await expect(backend.followUser("u_daniel")).rejects.toMatchObject({ code: "follow_wait" });
  });

  it("si los dos se piden seguir quedan siguiéndose, y cancelar no borra los rechazos", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_valentina");
    await backend.followUser("u_daniel");
    await signInAs(backend, "u_daniel");
    await expect(backend.followUser("u_valentina")).resolves.toBe("accepted");
    await backend.unfollowUser("u_valentina");
    await backend.followUser("u_valentina");
    await backend.unfollowUser("u_valentina");
    await backend.loadNetwork();
    expect(networkOf(backend.getSnapshot()).sent).not.toContain("u_valentina");
  });

  it("cerrar el caso o eliminarlo cierra sus chats y ya no se puede escribir desde ahí", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_daniel");
    const dm = await backend.openDirect("rocky");
    await signInAs(backend, "u_valentina");
    await backend.markReunited("rocky", []);
    const state = backend.getSnapshot();
    expect(state.threads.find((t) => t.id === dm)?.archived).toBe(true);
    await signInAs(backend, "u_daniel");
    await expect(backend.openDirect("rocky")).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("busca por nombre de usuario sin importar el @", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_valentina");
    const username = backend.getSnapshot().users.u_maria?.username ?? "";
    expect((await backend.searchUsers(`@${username.slice(0, 3)}`)).map((u) => u.id)).toContain("u_maria");
    expect(await backend.searchUsers("ma")).toEqual([]);
  });

  it("las estrellas al cerrar el caso cambian la calificación y la insignia Protector animal", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_valentina");
    await backend.markReunited("rocky", ["u_daniel"], { u_daniel: 3 });
    const state = backend.getSnapshot();
    expect(ratingOf(state, "u_daniel")).toEqual({ average: 4.9, count: 1 });
    expect(userStats(state, "u_daniel")).toMatchObject({ ratingAvg: 4.9, ratingCount: 1 });
    expect(userBadgeProgress(state, "u_daniel").find((b) => b.id === "protector")?.tier).toBe(0);
  });

  it("PawFamily: novedades después de adoptar, solo entre quien la dio y quien adoptó", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_maria");
    await expectCode(backend.addAdoptionUpdate("ad_canela", { body: "Hola" }), "not_allowed");
    await signInAs(backend, "u_daniel");
    await backend.acceptApplication("ap_maria_canela");
    await backend.markAdopted("ad_canela");
    await expectCode(backend.addAdoptionUpdate("ad_canela", { body: "Hola" }), "not_allowed");

    await signInAs(backend, "u_maria");
    await expectCode(backend.addAdoptionUpdate("ad_canela", { body: "   " }), "invalid_input");
    await expectCode(backend.addAdoptionUpdate("ad_nada", { body: "Hola" }), "not_found");
    const update = await backend.addAdoptionUpdate("ad_canela", { body: " Ya duerme en su cama ", photo: "file:///c.jpg" });
    expect(update).toMatchObject({ body: "Ya duerme en su cama", photo: "file:///c.jpg", authorId: "u_maria" });
    await expect(backend.loadAdoptionUpdates("ad_canela")).resolves.toHaveLength(1);

    await signInAs(backend, "u_daniel");
    await expect(backend.loadAdoptionUpdates("ad_canela")).resolves.toEqual([update]);
    await signInAs(backend, "u_valentina");
    await expectCode(backend.loadAdoptionUpdates("ad_canela"), "not_allowed");
    await expectCode(backend.loadAdoptionUpdates("ad_nada"), "not_found");
  });

  it("PawFamily: el perfil de un refugio cuenta lo que tiene en adopción y lo adoptado", async () => {
    const backend = makeBackend();
    expect(shelterSummaryOf(backend.getSnapshot(), "u_daniel")).toEqual({
      name: "Fundación Huellitas",
      available: 3,
      adopted: 0,
    });
    expect(shelterSummaryOf(backend.getSnapshot(), "u_valentina")).toBeUndefined();
    await expect(backend.loadUserAdoptions("u_daniel")).resolves.toHaveLength(3);
    await signInAs(backend, "u_daniel");
    await backend.markAdopted("ad_canela");
    expect(shelterSummaryOf(backend.getSnapshot(), "u_daniel")).toEqual({
      name: "Fundación Huellitas",
      available: 2,
      adopted: 1,
    });
    await expect(backend.loadUserAdoptions("u_daniel")).resolves.not.toContain("ad_canela");
  });

  it("adoptar en PawFamily da la insignia «Nuevo integrante»", async () => {
    const backend = makeBackend();
    await signInAs(backend, "u_maria");
    expect(userBadgeProgress(backend.getSnapshot(), "u_maria").find((b) => b.id === "new_member")?.tier).toBe(0);
    await signInAs(backend, "u_daniel");
    await backend.acceptApplication("ap_maria_canela");
    await backend.markAdopted("ad_canela");
    expect(userBadgeProgress(backend.getSnapshot(), "u_maria").find((b) => b.id === "new_member")?.tier).toBe(1);
  });

  it("estadísticas, insignias y actividad salen de datos reales", () => {
    const backend = makeBackend();
    const state = backend.getSnapshot();
    expect(userStats(state, "u_valentina")).toEqual({ reported: 1, found: 1, ratingAvg: 5, ratingCount: 0 });
    const earned = userBadgeProgress(state, "u_valentina")
      .filter((b) => b.tier > 0)
      .map((b) => `${b.id}:${b.tier}`);
    expect(earned).toEqual(["verified:1", "reporter:1", "rescuer:1", "paw_angel:1", "reunion:1", "spreader:1", "community:1"]);
    expect(userActivity(state, "u_valentina").map((a) => a.kind)).toEqual(["lost", "reunited", "found"]);
    expect(userBadgeProgress(state, "u_nadie")).toEqual([]);
  });
});
