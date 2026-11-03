import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Files from "expo-file-system/legacy";
import * as Location from "expo-location";

import { ApiBackend } from "../apiBackend";
import { BackendError } from "../backendTypes";
import { userBadgeProgress } from "../selectors";
import { ME_KEY } from "../sessionKeys";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

jest.mock("expo-file-system/legacy", () => ({
  FileSystemUploadType: { MULTIPART: 1 },
  uploadAsync: jest.fn(),
}));

jest.mock("../photoShrink", () => ({
  photoExists: jest.fn(async (uri: string) => !uri.includes("borrada")),
  shrinkPhoto: jest.fn(async (uri: string) => `${uri}?chica`),
}));

const BASE = "https://api.test";
const LAURELES = { latitude: 6.2449, longitude: -75.5912 };
const ENVIGADO_LEJOS = { latitude: 7.5, longitude: -75.5912 };

type Call = { method: string; path: string; body: unknown; auth: string | undefined };
type Reply = { status?: number; body?: unknown };

let calls: Call[];
let routes: Map<string, Reply | ((call: Call) => Reply)>;

const route = (key: string, reply: Reply | ((call: Call) => Reply)) => routes.set(key, reply);
const called = (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key);
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

class FakeSocket {
  static last: FakeSocket | null = null;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

const emit = (type: string, data: unknown) => FakeSocket.last?.onmessage?.({ data: JSON.stringify({ type, data }) });

const user = (over: object = {}) => ({
  id: "u_ana",
  name: "Ana Gómez",
  username: "ana_g",
  email: "ana@x.co",
  verified: true,
  avatar: "fox",
  title: "rescuer",
  bio: "",
  city: "Medellín",
  createdAt: "2026-01-01T00:00:00Z",
  lang: "es",
  ...over,
});

const me = (over: object = {}) => ({
  user: user(),
  notificationPrefs: { push: true, angelAlerts: true },
  privacyPrefs: { whoCanMessage: "everyone" },
  alertZone: null,
  allowance: { allowed: true },
  activeSessions: 2,
  ...over,
});

const session = (over: object = {}) => ({ accessToken: "a1", refreshToken: "r1", me: me(), needsVerification: false, ...over });

const summary = (id: string, shortName = "Carlos M.") => ({
  id,
  shortName,
  avatar: "cat",
  verified: true,
  createdAt: "2026-01-01T00:00:00Z",
  lang: "es",
});

const pet = (id: string, over: object = {}) => ({
  id,
  kind: "lost",
  state: "active",
  name: id,
  species: "dog",
  ownerId: "u_otro",
  groupId: `grp_${id}`,
  location: LAURELES,
  zone: "Laureles",
  sightings: [],
  photos: [],
  owner: summary("u_otro"),
  ...over,
});

const thread = (id: string, over: object = {}) => ({
  id,
  kind: "group",
  petId: undefined,
  archived: false,
  memberIds: ["u_ana"],
  archivedBy: [],
  mutedBy: [],
  readAt: {},
  members: [summary("u_carlos")],
  ...over,
});

const message = (id: string, over: object = {}) => ({
  id,
  threadId: "grp_max",
  authorId: "u_carlos",
  authorShortName: "Carlos M.",
  kind: "text",
  text: "hola",
  at: "2026-10-27T12:00:00Z",
  ...over,
});

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BackendError);
  return (error as BackendError).code;
};

async function loggedIn(over: object = {}) {
  const backend = new ApiBackend(BASE);
  route("POST /v1/auth/login", { body: session(over) });
  await backend.login("ana@x.co", "Clave1234");
  await flush();
  return backend;
}

beforeEach(() => {
  calls = [];
  routes = new Map();
  FakeSocket.last = null;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  jest.mocked(Files.uploadAsync).mockReset();
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(BASE, "");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? "GET",
      path,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.Authorization,
    };
    calls.push(call);
    const found = routes.get(`${call.method} ${path}`);
    const reply = typeof found === "function" ? found(call) : found;
    const status = reply?.status ?? (reply?.body !== undefined || call.method === "GET" ? 200 : 204);
    const body = reply?.body ?? (call.method === "GET" ? [] : null);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (body === "no-json") throw new Error("no es JSON");
        return body;
      },
    } as Response;
  }) as unknown as typeof fetch;
});

describe("peticiones y errores", () => {
  it("sin red avisa de la red, no de un error desconocido", async () => {
    const backend = new ApiBackend(BASE);
    jest.mocked(global.fetch).mockRejectedValueOnce(new Error("sin red"));
    expect(await codeOf(backend.login("a@x.co", "x"))).toBe("network");
  });

  it("entrega los códigos conocidos con sus parámetros; los demás son desconocidos", async () => {
    const backend = new ApiBackend(BASE);
    route("POST /v1/auth/login", { status: 429, body: { error: { code: "rate_limited", params: { retryAfter: 30 } } } });
    const error = await backend.login("a@x.co", "x").catch((e: BackendError) => e);
    expect(error).toMatchObject({ code: "rate_limited", params: { retryAfter: 30 } });

    route("POST /v1/auth/login", { status: 500, body: { error: { code: "inventado" } } });
    expect(await codeOf(backend.login("a@x.co", "x"))).toBe("unknown");
    route("POST /v1/auth/login", { status: 502, body: "no-json" });
    expect(await codeOf(backend.login("a@x.co", "x"))).toBe("unknown");
  });

  it("envía el token de acceso en cada petición con sesión", async () => {
    const backend = await loggedIn();
    await backend.sharePet("max");
    expect(called("POST /v1/pets/max/share")[0]?.auth).toBe("Bearer a1");
  });

  it("con el token vencido lo renueva una sola vez y repite la petición", async () => {
    const backend = await loggedIn();
    let first = true;
    const expired = () => {
      if (first) {
        first = false;
        return { status: 401, body: { error: { code: "unauthorized" } } };
      }
      return { status: 204 };
    };
    route("POST /v1/pets/max/share", expired);
    route("POST /v1/auth/refresh", { status: 200, body: session({ accessToken: "a2", refreshToken: "r2" }) });
    await backend.sharePet("max");
    const shares = called("POST /v1/pets/max/share");
    expect(shares.map((c) => c.auth)).toEqual(["Bearer a1", "Bearer a2"]);
    expect(called("POST /v1/auth/refresh")).toHaveLength(1);
    expect(called("POST /v1/auth/refresh")[0]?.body).toEqual({ refreshToken: "r1" });
  });

  it("varias peticiones vencidas a la vez comparten una sola renovación", async () => {
    const backend = await loggedIn();
    route("POST /v1/pets/a/share", (c) => (c.auth === "Bearer a1" ? { status: 401 } : { status: 204 }));
    route("POST /v1/pets/b/share", (c) => (c.auth === "Bearer a1" ? { status: 401 } : { status: 204 }));
    route("POST /v1/auth/refresh", { status: 200, body: session({ accessToken: "a2" }) });
    await Promise.all([backend.sharePet("a"), backend.sharePet("b")]);
    expect(called("POST /v1/auth/refresh")).toHaveLength(1);
  });

  it("si la API rechaza la renovación, cierra la sesión", async () => {
    const backend = await loggedIn();
    route("POST /v1/pets/max/share", { status: 401, body: { error: { code: "unauthorized" } } });
    route("POST /v1/auth/refresh", { status: 401 });
    expect(await codeOf(backend.sharePet("max"))).toBe("unauthorized");
    expect(backend.currentUser).toBeNull();
    expect(FakeSocket.last?.closed).toBe(true);
  });

  it("si la renovación falla por el servidor o la red, la sesión sigue abierta", async () => {
    const backend = await loggedIn();
    route("POST /v1/pets/max/share", { status: 401 });
    route("POST /v1/auth/refresh", { status: 503 });
    expect(await codeOf(backend.sharePet("max"))).toBe("network");
    expect(backend.currentUser?.id).toBe("u_ana");

    jest
      .mocked(global.fetch)
      .mockImplementationOnce(async () => ({ status: 401, ok: false, json: async () => null }) as Response);
    jest.mocked(global.fetch).mockRejectedValueOnce(new Error("sin red"));
    expect(await codeOf(backend.sharePet("max"))).toBe("network");
    expect(backend.currentUser?.id).toBe("u_ana");
  });
});

describe("cuenta", () => {
  it("el login entra, sincroniza y deja la cuenta como sesión actual", async () => {
    const backend = await loggedIn();
    expect(backend.currentUser).toMatchObject({ id: "u_ana", email: "ana@x.co" });
    expect(backend.getSnapshot().activeSessions).toBe(2);
    expect(called("GET /v1/me/notifications")).toHaveLength(1);
    expect(backend.getSnapshot().threadsLoaded).toBe(true);
  });

  it("un login sin verificar arranca la espera para reenviar el código", async () => {
    const backend = await loggedIn({ needsVerification: true });
    expect(backend.secondsUntilResend()).toBeGreaterThan(40);
    await backend.sendVerificationCode();
    expect(called("POST /v1/auth/email/resend")).toHaveLength(0);
  });

  it("registrar envía los consentimientos y el nombre de usuario", async () => {
    const backend = new ApiBackend(BASE);
    route("POST /v1/auth/register", { status: 201, body: session({ needsVerification: true }) });
    await backend.register({ name: "Ana Gómez", email: "ana@x.co", username: "ana_g", password: "Clave1234" });
    await flush();
    expect(called("POST /v1/auth/register")[0]?.body).toMatchObject({ username: "ana_g", acceptTerms: true, confirmAge: true });
    expect(backend.secondsUntilResend()).toBeGreaterThan(40);
  });

  it("verifica el código y reenvía cuando ya pasó la espera", async () => {
    const backend = await loggedIn();
    route("POST /v1/auth/email/verify", { status: 200, body: me({ user: user({ verified: true, name: "Ana Verificada" }) }) });
    await backend.verifyCode("123456");
    expect(called("POST /v1/auth/email/verify")[0]?.body).toEqual({ code: "123456" });
    expect(backend.currentUser?.name).toBe("Ana Verificada");

    await backend.sendVerificationCode();
    expect(called("POST /v1/auth/email/resend")).toHaveLength(1);
    expect(backend.secondsUntilResend()).toBeGreaterThan(40);
  });

  it("al cerrar sesión da de baja el celular antes de salir", async () => {
    const backend = await loggedIn();
    await backend.registerPushToken("ExponentPushToken[x]", "android");
    await backend.logout();
    const order = calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf("DELETE /v1/me/devices")).toBeLessThan(order.indexOf("POST /v1/auth/logout"));
    expect(called("DELETE /v1/me/devices")[0]?.body).toEqual({ token: "ExponentPushToken[x]" });
    expect(backend.currentUser).toBeNull();
  });

  it("sin sesión no registra el celular", async () => {
    const backend = new ApiBackend(BASE);
    await backend.registerPushToken("t", "android");
    await backend.logout();
    expect(calls).toHaveLength(0);
  });

  it("restaura la sesión guardada y la confirma con la API", async () => {
    const first = await loggedIn();
    expect(first.currentUser).not.toBeNull();
    route("GET /v1/me", { status: 200, body: me({ user: user({ name: "Ana Actual" }) }) });
    const backend = new ApiBackend(BASE);
    await expect(backend.restoreSession("u_ana")).resolves.toBe(true);
    await flush();
    expect(backend.currentUser?.name).toBe("Ana Actual");
  });

  it("sin tokens guardados no hay sesión que restaurar", async () => {
    const first = await loggedIn();
    await first.logout();
    await expect(new ApiBackend(BASE).restoreSession("u_ana")).resolves.toBe(false);
  });

  it("si la API dice que la sesión ya no vale, la cierra; sin red la conserva y reintenta", async () => {
    await loggedIn();
    route("GET /v1/me", { status: 401, body: { error: { code: "unauthorized" } } });
    route("POST /v1/auth/refresh", { status: 401 });
    const rejected = new ApiBackend(BASE);
    await rejected.restoreSession("u_ana");
    await flush();
    expect(rejected.currentUser).toBeNull();

    await loggedIn();
    let retry: (() => void) | undefined;
    const realTimeout = global.setTimeout;
    const spy = jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 2000) {
        retry = fn;
        return 0;
      }
      return realTimeout(fn, ms);
    }) as never);
    route("GET /v1/me", { status: 500 });
    const offline = new ApiBackend(BASE);
    await offline.restoreSession("u_ana");
    await flush();
    expect(retry).toBeDefined();
    route("GET /v1/me", { status: 200, body: me({ user: user({ name: "Ana de nuevo" }) }) });
    retry?.();
    await flush();
    spy.mockRestore();
    expect(offline.currentUser?.name).toBe("Ana de nuevo");
  });

  it("guarda el estado de publicación que informa la API", async () => {
    const retryAt = new Date(Date.now() + 3_600_000).toISOString();
    const limited = await loggedIn({ me: me({ allowance: { allowed: false, retryAt } }) });
    expect(limited.publishAllowanceFor("u_ana")).toEqual({ allowed: false, retryAt: new Date(retryAt) });

    const past = new Date(Date.now() - 1000).toISOString();
    const expired = await loggedIn({ me: me({ allowance: { allowed: false, retryAt: past } }) });
    expect(expired.publishAllowanceFor("u_ana")).toEqual({ allowed: true });
    expect((await loggedIn()).publishAllowanceFor("u_ana")).toEqual({ allowed: true });
  });

  it("pide restablecer contraseña, exporta y elimina la cuenta", async () => {
    const backend = await loggedIn();
    await backend.requestPasswordReset("ana@x.co");
    expect(called("POST /v1/auth/password-reset")[0]?.body).toEqual({ email: "ana@x.co" });
    route("GET /v1/me/export", { status: 200, body: { reports: [] } });
    expect(JSON.parse(await backend.exportData())).toEqual({ reports: [] });
    await backend.deleteAccount();
    expect(called("DELETE /v1/me")).toHaveLength(1);
    expect(backend.currentUser).toBeNull();
  });

  it("lo de moderación no se puede hacer desde la app real", async () => {
    const backend = await loggedIn();
    expect(() => backend.applyModerationRemoval("max")).toThrow(BackendError);
    expect(() => backend.applyModerationMute("u", 1)).toThrow(BackendError);
  });
});

describe("sincronización", () => {
  it("trae chats, últimos mensajes, notificaciones, y carga las mascotas que faltan", async () => {
    route("GET /v1/me/pets", { status: 200, body: [pet("mia", { ownerId: "u_ana" })] });
    route("GET /v1/threads", {
      status: 200,
      body: [thread("grp_max", { lastMessage: message("m1", { photo: { url: "https://x/f.jpg", width: 10, height: 20 } }) })],
    });
    route("GET /v1/me/notifications", {
      status: 200,
      body: [{ id: "n1", userId: "u_ana", kind: "sighting", petId: "otra", read: false }],
    });
    route("GET /v1/me/owned-pets", { status: 200, body: [{ id: "own", ownerId: "u_ana" }] });
    route("GET /v1/pets/otra", { status: 200, body: pet("otra") });
    const backend = await loggedIn();
    const state = backend.getSnapshot();
    expect(state.pets.map((p) => p.id).sort()).toEqual(["mia", "otra"]);
    expect(state.threads[0]?.id).toBe("grp_max");
    expect(state.messages[0]?.photo).toEqual({ uri: "https://x/f.jpg", width: 10, height: 20 });
    expect(state.ownedPets).toHaveLength(1);
  });

  it("de otras cuentas guarda solo lo público: nunca correo ni celular", async () => {
    route("GET /v1/threads", { status: 200, body: [thread("t", { members: [summary("u_carlos", "Carlos M.")] })] });
    const backend = await loggedIn();
    expect(backend.getSnapshot().users.u_carlos).toMatchObject({ name: "Carlos M.", email: "", username: "" });
  });

  it("sin red no rompe: termina de cargar y lo intenta en la siguiente ronda", async () => {
    const backend = await loggedIn();
    jest.mocked(global.fetch).mockRejectedValue(new Error("sin red"));
    backend.runScheduledJobs();
    await flush();
    expect(backend.getSnapshot().threadsLoaded).toBe(true);
    expect(backend.currentUser?.id).toBe("u_ana");
  });
});

describe("conexión en vivo", () => {
  it("el token va en el primer mensaje, nunca en la URL", async () => {
    await loggedIn();
    const socket = FakeSocket.last;
    expect(socket?.url).toBe("wss://api.test/v1/ws");
    socket?.onopen?.();
    expect(JSON.parse(socket?.sent[0] ?? "{}")).toEqual({ type: "auth", token: "a1" });
  });

  it("no abre dos conexiones, y al cortarse se reconecta en la siguiente sincronización", async () => {
    const backend = await loggedIn();
    const first = FakeSocket.last;
    backend.runScheduledJobs();
    await flush();
    expect(FakeSocket.last).toBe(first);
    first?.onclose?.();
    backend.runScheduledJobs();
    await flush();
    expect(FakeSocket.last).not.toBe(first);
  });

  it("agrega mensajes y notificaciones sin duplicarlas, y carga la mascota si falta", async () => {
    const backend = await loggedIn();
    emit("message", message("m9"));
    expect(backend.getSnapshot().messages.map((m) => m.id)).toEqual(["m9"]);
    route("GET /v1/pets/max", { status: 200, body: pet("max") });
    const notification = { id: "n9", userId: "u_ana", kind: "sighting", petId: "max", read: false };
    emit("notification", notification);
    emit("notification", notification);
    await flush();
    expect(backend.getSnapshot().notifications).toHaveLength(1);
    expect(backend.getPet("max")?.id).toBe("max");
  });

  it("un reporte nuevo aparece al instante, sin pisar lo que ya se tenía", async () => {
    const backend = await loggedIn();
    emit("pet", pet("nueva", { name: "Primera" }));
    expect(backend.getPet("nueva")?.name).toBe("Primera");
    emit("pet", pet("nueva", { name: "Otra" }));
    expect(backend.getPet("nueva")?.name).toBe("Primera");
  });

  it("al encontrarla deja de estar activa, se cierra su grupo y se quitan sus historias", async () => {
    route("GET /v1/threads", { status: 200, body: [thread("grp_max")] });
    const backend = await loggedIn();
    emit("pet", pet("max"));
    route("POST /v1/pets/max/stories", { status: 201, body: { id: "s1", petId: "max" } });
    await backend.addStory("max", { text: "hola" });
    emit("pet_closed", { id: "max", removed: false, at: "2026-11-01T10:00:00Z" });
    const state = backend.getSnapshot();
    expect(state.pets.find((p) => p.id === "max")).toMatchObject({ state: "reunited", reunitedAt: "2026-11-01T10:00:00Z" });
    expect(state.threads.find((t) => t.id === "grp_max")?.archived).toBe(true);
    expect(state.stories).toHaveLength(0);
  });

  it("un caso archivado por falta de novedades queda archivado, no reencontrado, y conserva sus avisos", async () => {
    route("GET /v1/threads", { status: 200, body: [thread("grp_max")] });
    route("GET /v1/me/notifications", {
      status: 200,
      body: [{ id: "n1", userId: "u_ana", kind: "case_archived", petId: "max", read: false }],
    });
    route("GET /v1/pets/max", { status: 200, body: pet("max") });
    const backend = await loggedIn();
    emit("pet", pet("max"));
    emit("pet_closed", { id: "max", removed: false, archived: true, at: "2026-11-01T10:00:00Z" });
    const state = backend.getSnapshot();
    expect(state.pets.find((p) => p.id === "max")).toMatchObject({ state: "archived" });
    expect(state.pets.find((p) => p.id === "max")?.reunitedAt).toBeUndefined();
    expect(state.threads.find((t) => t.id === "grp_max")?.archived).toBe(true);
    expect(state.notifications.map((n) => n.kind)).toEqual(["case_archived"]);
  });

  it("una publicación eliminada desaparece junto con sus notificaciones", async () => {
    route("GET /v1/pets/max", { status: 200, body: pet("max") });
    route("GET /v1/me/notifications", {
      status: 200,
      body: [{ id: "n1", userId: "u_ana", kind: "sighting", petId: "max", read: false }],
    });
    const backend = await loggedIn();
    expect(backend.getPet("max")).toBeDefined();
    emit("pet_closed", { id: "max", removed: true, at: "2026-11-01T10:00:00Z" });
    expect(backend.getPet("max")).toBeUndefined();
    expect(backend.getSnapshot().notifications).toHaveLength(0);
  });

  it("ignora eventos de casos que no conoce y los que no entiende", async () => {
    const backend = await loggedIn();
    const before = backend.getSnapshot();
    emit("pet_closed", { id: "ajena", removed: true, at: "x" });
    FakeSocket.last?.onmessage?.({ data: "esto no es JSON" });
    emit("otro_evento", {});
    expect(backend.getSnapshot()).toBe(before);
  });
});

describe("personas conectadas", () => {
  it("se actualiza en vivo y solo se cuenta con la app abierta", async () => {
    const backend = await loggedIn();
    expect(backend.getSnapshot().onlineCount).toBeNull();
    emit("online", 7);
    expect(backend.getSnapshot().onlineCount).toBe(7);

    const socket = FakeSocket.last;
    backend.setAppActive(false);
    expect(socket?.closed).toBe(true);
    // En segundo plano ni la sincronización la vuelve a abrir.
    backend.runScheduledJobs();
    await flush();
    expect(FakeSocket.last).toBe(socket);

    backend.setAppActive(true);
    expect(FakeSocket.last).not.toBe(socket);
  });

  it("sin cuenta lo consulta en cada ronda, y sin red no falla", async () => {
    const backend = new ApiBackend(BASE);
    route("GET /v1/online", { status: 200, body: { count: 3 } });
    backend.runScheduledJobs();
    await flush();
    expect(backend.getSnapshot().onlineCount).toBe(3);
    jest.mocked(global.fetch).mockRejectedValueOnce(new Error("sin red"));
    backend.runScheduledJobs();
    await flush();
    expect(backend.getSnapshot().onlineCount).toBe(3);
  });

  it("guarda si la cuenta es la de quien creó la app", async () => {
    const backend = await loggedIn({ me: me({ user: user({ founder: true }) }) });
    expect(backend.currentUser?.founder).toBe(true);
  });
});

describe("mascotas cercanas", () => {
  const nearbyPath = `/v1/pets?lat=${LAURELES.latitude}&lng=${LAURELES.longitude}&radius=20000`;
  const nearby = (list: unknown[]) => route(`GET ${nearbyPath}`, { status: 200, body: list });

  it("quita lo que la API ya no devuelve en la zona: dejó de estar activo", async () => {
    const backend = await loggedIn();
    nearby([pet("max"), pet("luna")]);
    await backend.loadNearby(LAURELES);
    expect(backend.getSnapshot().pets.map((p) => p.id)).toEqual(["max", "luna"]);
    nearby([pet("luna")]);
    await backend.loadNearby(LAURELES);
    expect(backend.getPet("max")).toBeUndefined();
    expect(backend.getPet("luna")).toBeDefined();
  });

  it("no quita lo propio, lo lejano ni lo que ya estaba cerrado", async () => {
    const backend = await loggedIn();
    nearby([pet("mia", { ownerId: "u_ana" }), pet("lejos", { location: ENVIGADO_LEJOS }), pet("cerrada", { state: "reunited" })]);
    await backend.loadNearby(LAURELES);
    nearby([]);
    await backend.loadNearby(LAURELES);
    expect(
      backend
        .getSnapshot()
        .pets.map((p) => p.id)
        .sort(),
    ).toEqual(["cerrada", "lejos", "mia"]);
  });

  it("con la lista llena no quita nada: no se sabe qué quedó por fuera", async () => {
    const backend = await loggedIn();
    nearby([pet("max")]);
    await backend.loadNearby(LAURELES);
    nearby(Array.from({ length: 200 }, (_, i) => pet(`p${i}`)));
    await backend.loadNearby(LAURELES);
    expect(backend.getPet("max")).toBeDefined();
  });

  it("sin cuenta también se actualiza cada ronda, porque no tiene conexión en vivo", async () => {
    const backend = new ApiBackend(BASE);
    backend.runScheduledJobs();
    await flush();
    expect(called(`GET ${nearbyPath}`)).toHaveLength(0);
    nearby([pet("max")]);
    await backend.loadNearby(LAURELES);
    nearby([pet("max"), pet("nueva")]);
    backend.runScheduledJobs();
    await flush();
    expect(backend.getPet("nueva")).toBeDefined();
    expect(FakeSocket.last).toBeNull();
  });

  it("sin red termina la espera: muestra el estado vacío, no esqueletos eternos", async () => {
    const backend = new ApiBackend(BASE);
    jest.mocked(global.fetch).mockRejectedValueOnce(new Error("sin red"));
    expect(await codeOf(backend.loadNearby(LAURELES))).toBe("network");
    expect(backend.getSnapshot().nearbyLoaded).toBe(true);
  });

  it("a los lugares solo llega una celda aproximada, nunca el punto exacto", async () => {
    const backend = await loggedIn();
    const exact = { latitude: 6.24512345, longitude: -75.59187654 };
    jest.mocked(global.fetch).mockClear();
    calls = [];
    await backend.loadPlaces(exact).catch(() => {});
    expect(calls[0]?.path).toMatch(/^\/v1\/places\?lat=/);
    expect(calls[0]?.path).not.toContain("6.2451");
    expect(calls[0]?.path).not.toContain("75.5918");
  });

  it("carga los lugares que devuelve la API y reporta un error en uno", async () => {
    const backend = await loggedIn();
    jest
      .mocked(global.fetch)
      .mockImplementationOnce(
        async () => ({ status: 200, ok: true, json: async () => ({ places: [{ id: "v1" }] }) }) as Response,
      );
    await backend.loadPlaces(LAURELES);
    expect(backend.getSnapshot().places).toEqual([{ id: "v1" }]);
    await backend.reportPlace("v1", "cerró");
    expect(called("POST /v1/places/v1/report")[0]?.body).toEqual({ note: "cerró" });
  });
});

describe("publicaciones", () => {
  it("elimina la publicación: sale de la lista y cierra su grupo", async () => {
    route("GET /v1/threads", { status: 200, body: [thread("grp_max")] });
    const backend = await loggedIn();
    emit("pet", pet("max", { ownerId: "u_ana" }));
    await backend.withdrawPet("max");
    expect(called("DELETE /v1/pets/max")).toHaveLength(1);
    expect(backend.getPet("max")).toBeUndefined();
    expect(backend.getSnapshot().threads[0]?.archived).toBe(true);
  });

  it("si la API no deja eliminarla, sigue en la lista", async () => {
    const backend = await loggedIn();
    emit("pet", pet("max"));
    route("DELETE /v1/pets/max", { status: 403, body: { error: { code: "not_allowed" } } });
    expect(await codeOf(backend.withdrawPet("max"))).toBe("not_allowed");
    expect(backend.getPet("max")).toBeDefined();
  });

  it("guarda el celular del afiche, y las listas no lo borran", async () => {
    const backend = await loggedIn();
    const nearbyPath = `GET /v1/pets?lat=${LAURELES.latitude}&lng=${LAURELES.longitude}&radius=20000`;
    route("PUT /v1/pets/max/contact", { status: 200, body: pet("max", { contactPhone: "+573001234567" }) });
    await backend.setContactPhone("max", "3001234567");
    expect(called("PUT /v1/pets/max/contact")[0]?.body).toEqual({ phone: "3001234567" });
    expect(backend.getPet("max")?.contactPhone).toBe("+573001234567");
    route(nearbyPath, { status: 200, body: [pet("max")] });
    await backend.loadNearby(LAURELES);
    expect(backend.getPet("max")?.contactPhone).toBe("+573001234567");
    route("PUT /v1/pets/max/contact", { status: 200, body: pet("max") });
    await backend.setContactPhone("max", "");
    expect(backend.getPet("max")?.contactPhone).toBeUndefined();
  });

  it("los candidatos a agradecer vienen del servidor, con su nombre", async () => {
    const backend = await loggedIn();
    route("GET /v1/pets/max/helpers", {
      status: 200,
      body: [{ userId: "u_carlos", user: summary("u_carlos", "Carlos M."), reasons: ["group"] }],
    });
    const [helper] = await backend.helperCandidates("max");
    expect(helper).toMatchObject({ userId: "u_carlos", reasons: ["group"], user: { name: "Carlos M." } });
    expect(backend.getSnapshot().users.u_carlos?.name).toBe("Carlos M.");
  });

  it("crea el reporte subiendo las fotos con el cargador nativo y refresca la cuenta", async () => {
    const backend = await loggedIn();
    jest.mocked(Files.uploadAsync).mockResolvedValue({ status: 201, body: JSON.stringify({ id: "med_1", url: "u" }) } as never);
    route("POST /v1/pets", { status: 201, body: pet("kira", { ownerId: "u_ana" }) });
    route("GET /v1/me", { status: 200, body: me() });
    const created = await backend.createReport({ kind: "lost", photos: ["file:///f.jpg", "https://ya/subida.jpg"] } as never);
    await flush();
    expect(created.id).toBe("kira");
    expect(called("POST /v1/pets")[0]?.body).toMatchObject({ photos: ["med_1", "https://ya/subida.jpg"] });
    const [url, file, options] = jest.mocked(Files.uploadAsync).mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/v1/media`);
    expect(file).toBe("file:///f.jpg?chica");
    expect(options).toMatchObject({ parameters: { purpose: "pet" }, headers: { Authorization: "Bearer a1" } });
  });

  it("una foto de un borrador viejo se reporta como foto inválida, no como falta de internet", async () => {
    const backend = await loggedIn();
    expect(await codeOf(backend.createReport({ photos: ["file:///borrada.jpg"] } as never))).toBe("invalid_image");
    expect(Files.uploadAsync).not.toHaveBeenCalled();
  });

  it("la subida renueva la sesión una vez y explica los errores", async () => {
    const backend = await loggedIn();
    const upload = jest.mocked(Files.uploadAsync);
    route("POST /v1/auth/refresh", { status: 200, body: session({ accessToken: "a2" }) });
    upload.mockResolvedValueOnce({ status: 401, body: "" } as never);
    upload.mockResolvedValueOnce({ status: 201, body: JSON.stringify({ id: "med_2" }) } as never);
    route("PATCH /v1/me", { status: 200, body: me() });
    await backend.setProfilePhoto("file:///yo.jpg");
    expect(called("PATCH /v1/me")[0]?.body).toEqual({ photoId: "med_2" });
    expect(upload.mock.calls[1]?.[2]).toMatchObject({ headers: { Authorization: "Bearer a2" } });

    upload.mockResolvedValueOnce({ status: 422, body: JSON.stringify({ error: { code: "invalid_image" } }) } as never);
    expect(await codeOf(backend.setProfilePhoto("file:///yo.jpg"))).toBe("invalid_image");
    upload.mockResolvedValueOnce({ status: 500, body: "<html>" } as never);
    expect(await codeOf(backend.setProfilePhoto("file:///yo.jpg"))).toBe("unknown");
    upload.mockRejectedValueOnce(new Error("sin red"));
    expect(await codeOf(backend.setProfilePhoto("file:///yo.jpg"))).toBe("network");

    upload.mockResolvedValueOnce({ status: 401, body: "" } as never);
    route("POST /v1/auth/refresh", { status: 503 });
    expect(await codeOf(backend.setProfilePhoto("file:///yo.jpg"))).toBe("network");
  });

  it("quitar la foto de perfil no sube nada", async () => {
    const backend = await loggedIn();
    route("PATCH /v1/me", { status: 200, body: me() });
    await backend.setProfilePhoto(null);
    expect(called("PATCH /v1/me")[0]?.body).toEqual({ photoId: "" });
    expect(Files.uploadAsync).not.toHaveBeenCalled();
  });

  it("registra avistamientos, reencuentro, historias y reportes", async () => {
    const backend = await loggedIn();
    route("POST /v1/pets/max/sightings", { status: 201, body: pet("max", { sightings: [{ id: "s1", note: "sin autor" }] }) });
    await backend.addSighting("max", { at: "x", location: LAURELES, zone: "Laureles" });
    expect(backend.getPet("max")?.sightings[0]?.authorId).toBe("");

    route("POST /v1/pets/max/stories", { status: 201, body: { id: "st1", petId: "max" } });
    jest.mocked(Files.uploadAsync).mockResolvedValue({ status: 201, body: JSON.stringify({ id: "med_s" }) } as never);
    await backend.addStory("max", { text: "hola", photo: "file:///h.jpg" });
    expect(called("POST /v1/pets/max/stories")[0]?.body).toEqual({ text: "hola", photoId: "med_s" });
    route("POST /v1/pets/max/stories", { status: 201, body: { id: "st2", petId: "max" } });
    await backend.addStory("max", { text: "sin foto" });
    expect(backend.getSnapshot().stories).toHaveLength(2);
    await backend.removeStory("st2");
    expect(backend.getSnapshot().stories.map((s) => s.id)).toEqual(["st1"]);

    route("POST /v1/pets/max/reunite", { status: 200, body: pet("max", { state: "reunited" }) });
    await backend.markReunited("max", ["u_carlos"]);
    expect(called("POST /v1/pets/max/reunite")[0]?.body).toEqual({ helperIds: ["u_carlos"], ratings: {} });
    expect(backend.getPet("max")?.state).toBe("reunited");
    expect(backend.getSnapshot().stories).toHaveLength(0);

    await backend.reportPost("max");
    expect(called("POST /v1/pets/max/report")[0]?.body).toEqual({ reason: "other" });
    await backend.sharePet("max");
    expect(called("POST /v1/pets/max/share")).toHaveLength(1);
  });

  it("carga una mascota: si ya no existe no falla; otros errores sí", async () => {
    const backend = await loggedIn();
    route("GET /v1/pets/ida", { status: 404, body: { error: { code: "not_found" } } });
    await expect(backend.loadPet("ida")).resolves.toBeUndefined();
    route("GET /v1/pets/ida", { status: 500 });
    expect(await codeOf(backend.loadPet("ida"))).toBe("unknown");
  });

  it("guarda y borra el perfil de Mis mascotas", async () => {
    const backend = await loggedIn();
    route("POST /v1/me/owned-pets", { status: 201, body: { id: "own", ownerId: "u_ana", name: "Rocky" } });
    await backend.saveOwnedPet({ name: "Rocky", photos: [] } as never);
    route("PUT /v1/me/owned-pets/own", { status: 200, body: { id: "own", ownerId: "u_ana", name: "Rocko" } });
    await backend.saveOwnedPet({ name: "Rocko", photos: [] } as never, "own");
    expect(backend.getSnapshot().ownedPets).toEqual([{ id: "own", ownerId: "u_ana", name: "Rocko" }]);
    await backend.deleteOwnedPet("own");
    expect(backend.getSnapshot().ownedPets).toEqual([]);
  });
});

describe("ubicación de las alertas", () => {
  const zone = { location: LAURELES, zone: "Laureles" };

  it("activa, actualiza y revoca", async () => {
    const backend = await loggedIn();
    await backend.updateAlertLocation(LAURELES);
    expect(called("PUT /v1/me/location")).toHaveLength(0);

    route("PUT /v1/me/location", { status: 200, body: { ...zone, updatedAt: "ahora" } });
    await backend.setAlertZone(zone);
    expect(backend.getSnapshot().alertZones.u_ana).toMatchObject({ zone: "Laureles", updatedAt: "ahora" });

    route("PUT /v1/me/location", { status: 204 });
    await backend.updateAlertLocation(ENVIGADO_LEJOS, "Otra");
    expect(called("PUT /v1/me/location")[1]?.body).toEqual({ location: ENVIGADO_LEJOS, zone: "Otra" });
    await backend.updateAlertLocation(LAURELES);
    expect(called("PUT /v1/me/location")[2]?.body).toEqual({ location: LAURELES, zone: "Otra" });

    await backend.setAlertZone(null);
    expect(called("DELETE /v1/me/location")).toHaveLength(1);
    expect(backend.getSnapshot().alertZones.u_ana).toBeUndefined();
  });

  it("deja la zona donde la lee la tarea que corre con la app cerrada", async () => {
    const backend = await loggedIn();
    route("PUT /v1/me/location", { status: 200, body: { ...zone, updatedAt: "ahora" } });
    await backend.setAlertZone(zone);
    expect(JSON.parse((await AsyncStorage.getItem(ME_KEY)) ?? "{}").alertZone).toMatchObject({ zone: "Laureles" });
    await backend.setAlertZone(null);
    expect(JSON.parse((await AsyncStorage.getItem(ME_KEY)) ?? "{}").alertZone).toBeNull();
  });

  it("al cerrar sesión deja de seguir la ubicación", async () => {
    const backend = await loggedIn();
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValueOnce(true);
    jest.mocked(Location.stopLocationUpdatesAsync).mockClear();
    await backend.logout();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it("sin sesión no se puede activar, y actualizar el GPS sin red no molesta", async () => {
    expect(await codeOf(new ApiBackend(BASE).setAlertZone(zone))).toBe("not_allowed");
    const backend = await loggedIn({ me: me({ alertZone: zone }) });
    route("PUT /v1/me/location", { status: 500 });
    await expect(backend.updateAlertLocation(LAURELES)).resolves.toBeUndefined();
  });
});

describe("chats", () => {
  const loadThreadRoutes = (id: string, over: object = {}) => {
    route(`GET /v1/threads/${id}`, { status: 200, body: thread(id, over) });
    route(`GET /v1/threads/${id}/messages`, { status: 200, body: [message("m1", { threadId: id })] });
  };

  it("unirse y abrir un directo cargan el chat y su mascota", async () => {
    const backend = await loggedIn();
    route("POST /v1/pets/max/join", { status: 200, body: { threadId: "grp_max" } });
    loadThreadRoutes("grp_max", { petId: "max" });
    route("GET /v1/pets/max", { status: 200, body: pet("max") });
    await expect(backend.joinGroup("max")).resolves.toBe("grp_max");
    expect(backend.getPet("max")).toBeDefined();
    expect(backend.getSnapshot().messages[0]?.threadId).toBe("grp_max");

    route("POST /v1/pets/max/direct", { status: 200, body: { threadId: "dm_1" } });
    loadThreadRoutes("dm_1", { kind: "dm", petId: "max" });
    await expect(backend.openDirect("max")).resolves.toBe("dm_1");
    expect(called("GET /v1/pets/max")).toHaveLength(1);
  });

  it("cierra, archiva y sale de un chat", async () => {
    const backend = await loggedIn();
    loadThreadRoutes("dm_1", { kind: "dm", archived: true });
    await backend.closeDirect("dm_1");
    expect(called("POST /v1/threads/dm_1/close")).toHaveLength(1);
    expect(backend.getSnapshot().threads[0]?.archived).toBe(true);

    route("POST /v1/threads/dm_1/archive", { status: 200, body: { archived: true } });
    await expect(backend.toggleArchive("dm_1")).resolves.toBe(true);
    expect(backend.getSnapshot().threads[0]?.archivedBy).toEqual(["u_ana"]);
    route("POST /v1/threads/dm_1/archive", { status: 200, body: { archived: false } });
    await backend.toggleArchive("dm_1");
    expect(backend.getSnapshot().threads[0]?.archivedBy).toEqual([]);

    await backend.leaveThread("dm_1");
    expect(backend.getSnapshot().threads[0]?.memberIds).toEqual([]);
  });

  it("envía texto, foto y ubicación, y deja de compartirla", async () => {
    const backend = await loggedIn();
    route("POST /v1/threads/t/messages", { status: 201, body: message("m2", { threadId: "t" }) });
    await backend.sendMessage("t", "hola");
    expect(called("POST /v1/threads/t/messages")[0]?.body).toEqual({ text: "hola", lang: "es" });

    jest.mocked(Files.uploadAsync).mockResolvedValue({ status: 201, body: JSON.stringify({ id: "med_c" }) } as never);
    await backend.sendMessage("t", "mira", "en", { uri: "file:///c.jpg", width: 1, height: 1 });
    expect(called("POST /v1/threads/t/messages")[1]?.body).toEqual({ text: "mira", lang: "en", photoId: "med_c" });

    await backend.shareLocation("t", { kind: "place", placeId: "v1" } as never);
    expect(called("POST /v1/threads/t/messages")[2]?.body).toMatchObject({ location: { kind: "place", placeId: "v1" } });
    await backend.shareLocation("t", { kind: "current", location: LAURELES, label: "Aquí" } as never, "en");
    expect(called("POST /v1/threads/t/messages")[3]?.body).toMatchObject({
      lang: "en",
      location: { kind: "current", location: LAURELES, label: "Aquí" },
    });

    route("DELETE /v1/messages/m2/location", { status: 200, body: message("m2", { text: "oculta" }) });
    await backend.stopSharingLocation("m2");
    expect(backend.getSnapshot().messages.find((m) => m.id === "m2")?.text).toBe("oculta");
  });

  it("marca leído y silencia", async () => {
    const backend = await loggedIn();
    loadThreadRoutes("t");
    await backend.loadThread("t");
    await backend.markThreadRead("t");
    expect(backend.getSnapshot().threads[0]?.readAt.u_ana).toBe("2026-10-27T12:00:00Z");
    route("POST /v1/threads/t/mute", { status: 200, body: { muted: true } });
    await backend.toggleMute("t");
    expect(backend.getSnapshot().threads[0]?.mutedBy).toEqual(["u_ana"]);
    route("POST /v1/threads/t/mute", { status: 200, body: { muted: false } });
    await backend.toggleMute("t");
    expect(backend.getSnapshot().threads[0]?.mutedBy).toEqual([]);
  });

  it("sin sesión marcar leído no falla", async () => {
    await expect(new ApiBackend(BASE).markThreadRead("t")).resolves.toBeUndefined();
  });

  it("las notificaciones quedan leídas al instante aunque falle la red", async () => {
    route("GET /v1/me/notifications", {
      status: 200,
      body: [
        { id: "n1", userId: "u_ana", kind: "sighting", petId: "max", read: false },
        { id: "n2", userId: "u_ana", kind: "sighting", petId: "max", read: false },
      ],
    });
    route("GET /v1/pets/max", { status: 200, body: pet("max") });
    const backend = await loggedIn();
    route("POST /v1/me/notifications/n1/read", { status: 500 });
    await backend.markNotificationRead("n1");
    expect(backend.getSnapshot().notifications.map((n) => n.read)).toEqual([true, false]);
    await backend.markAllNotificationsRead();
    expect(backend.getSnapshot().notifications.map((n) => n.read)).toEqual([true, true]);
    expect(called("POST /v1/me/notifications/read-all")).toHaveLength(1);
  });
});

describe("perfil y preferencias", () => {
  it("actualiza el perfil y el idioma, sin llamar si no cambia", async () => {
    const backend = await loggedIn();
    route("PATCH /v1/me", { status: 200, body: me({ user: user({ bio: "Hola" }) }) });
    await backend.updateProfile({ bio: "Hola" });
    expect(backend.currentUser?.bio).toBe("Hola");
    await backend.setLanguage("es");
    expect(called("PUT /v1/me/lang")).toHaveLength(0);
    await backend.setLanguage("en");
    expect(called("PUT /v1/me/lang")[0]?.body).toEqual({ lang: "en" });
    expect(backend.currentUser?.lang).toBe("en");
    await expect(new ApiBackend(BASE).setLanguage("en")).resolves.toBeUndefined();
  });

  it("las preferencias tienen valores por defecto y se guardan en la API", async () => {
    const backend = await loggedIn();
    expect(new ApiBackend(BASE).notificationPrefsFor("nadie")).toBeDefined();
    expect(new ApiBackend(BASE).privacyPrefsFor("nadie")).toBeDefined();
    route("PUT /v1/me/notification-prefs", { status: 200, body: { push: false, angelAlerts: false } });
    await backend.updateNotificationPrefs({ angelAlerts: false });
    expect(backend.notificationPrefsFor("u_ana")).toMatchObject({ angelAlerts: false });
    await backend.updatePrivacy({ whoCanMessage: "verified" });
    expect(called("PUT /v1/me/privacy")[0]?.body).toEqual({ whoCanMessage: "verified" });
    expect(backend.privacyPrefsFor("u_ana").whoCanMessage).toBe("verified");
  });

  it("los me gusta usan el total de la API", async () => {
    const backend = await loggedIn();
    route("POST /v1/users/u_carlos/like", { status: 200, body: { liked: true, likes: 3 } });
    await expect(backend.toggleProfileLike("u_carlos")).resolves.toBe(true);
    expect(backend.getSnapshot().profileLikes.u_carlos).toHaveLength(3);
    expect(backend.getSnapshot().profileLikes.u_carlos).toContain("u_ana");
    route("POST /v1/users/u_carlos/like", { status: 200, body: { liked: false, likes: 2 } });
    await backend.toggleProfileLike("u_carlos");
    expect(backend.getSnapshot().profileLikes.u_carlos).toHaveLength(2);
    expect(backend.getSnapshot().profileLikes.u_carlos).not.toContain("u_ana");
  });

  it("PawFamily: refugio en el perfil, mascotas de una cuenta y novedades después de adoptar", async () => {
    const backend = await loggedIn();
    const owner = {
      id: "u_o",
      shortName: "Refugio",
      avatar: "dog",
      verified: true,
      createdAt: "2026-01-01T00:00:00Z",
      lang: "es",
    };
    route("GET /v1/users/u_o", {
      status: 200,
      body: {
        user: { ...owner, name: "Refugio Patitas", username: "patitas", title: "animal_lover", bio: "", city: "Medellín" },
        likes: 0,
        likedByMe: false,
        rating: 0,
        ratingCount: 0,
        followers: 0,
        following: 0,
        followStatus: "none",
        badges: [],
        pets: [],
        shelter: { name: "Refugio Patitas", available: 1, adopted: 4 },
      },
    });
    await backend.loadProfile("u_o");
    expect(backend.getSnapshot().shelterSummaries.u_o).toEqual({ name: "Refugio Patitas", available: 1, adopted: 4 });

    route("GET /v1/users/u_o/adoptions", {
      status: 200,
      body: [
        {
          id: "ad_9",
          owner,
          name: "Toby",
          species: "dog",
          sex: "male",
          age: "young",
          size: "small",
          description: "Juguetón",
          vaccinated: true,
          sterilized: false,
          photos: ["https://x/t.jpg"],
          location: { latitude: 6.24, longitude: -75.59 },
          zone: "Laureles",
          status: "available",
          createdAt: "2026-11-01T00:00:00Z",
        },
      ],
    });
    await expect(backend.loadUserAdoptions("u_o")).resolves.toEqual(["ad_9"]);
    expect(backend.getSnapshot().adoptions.some((a) => a.id === "ad_9")).toBe(true);

    const update = {
      id: "upd_1",
      adoptionId: "ad_9",
      authorId: "u_ana",
      photo: "https://x/u.jpg",
      body: "Feliz",
      at: "2026-11-10T00:00:00Z",
    };
    route("GET /v1/adoptions/ad_9/updates", { status: 200, body: [update] });
    await expect(backend.loadAdoptionUpdates("ad_9")).resolves.toEqual([update]);
    route("POST /v1/adoptions/ad_9/updates", { status: 201, body: update });
    await expect(backend.addAdoptionUpdate("ad_9", { photo: "https://x/u.jpg", body: "Feliz" })).resolves.toEqual(update);
    expect(called("POST /v1/adoptions/ad_9/updates")[0]?.body).toEqual({ photo: "https://x/u.jpg", body: "Feliz" });

    // Un perfil sin refugio quita el resumen guardado.
    route("GET /v1/users/u_o", {
      status: 200,
      body: {
        user: { ...owner, name: "Refugio Patitas", username: "patitas", title: "animal_lover", bio: "", city: "Medellín" },
        likes: 0,
        likedByMe: false,
        rating: 0,
        ratingCount: 0,
        followers: 0,
        following: 0,
        followStatus: "none",
        badges: [],
        pets: [],
      },
    });
    await backend.loadProfile("u_o");
    expect(backend.getSnapshot().shelterSummaries.u_o).toBeUndefined();
  });

  it("PawFamily: busca, publica, se postula y responde solicitudes", async () => {
    const backend = await loggedIn();
    const owner = {
      id: "u_o",
      shortName: "Refugio",
      avatar: "dog",
      verified: true,
      createdAt: "2026-01-01T00:00:00Z",
      lang: "es",
    };
    const adoption = (over: object = {}) => ({
      id: "ad_1",
      owner,
      name: "Canela",
      species: "dog",
      sex: "female",
      age: "young",
      size: "medium",
      description: "Juguetona",
      vaccinated: true,
      sterilized: true,
      photos: ["https://x/c.jpg"],
      location: { latitude: 6.24, longitude: -75.59 },
      zone: "Laureles, Medellín",
      status: "available",
      createdAt: "2026-11-01T00:00:00Z",
      ...over,
    });
    route("GET /v1/adoptions?lat=6.2&lng=-75.5&radius=5000&city=Medell%C3%ADn&species=dog&sex=female", {
      status: 200,
      body: [adoption()],
    });
    await expect(
      backend.loadAdoptions(
        { latitude: 6.2, longitude: -75.5 },
        { radiusKm: 5, city: "Medellín", species: "dog", sex: "female" },
      ),
    ).resolves.toEqual(["ad_1"]);
    expect(backend.getSnapshot().adoptions[0]).toMatchObject({ id: "ad_1", ownerId: "u_o", name: "Canela" });
    expect(backend.getSnapshot().users.u_o?.name).toBe("Refugio");

    route("POST /v1/me/adoption-terms", { status: 204 });
    await backend.acceptAdoptionTerms();
    route("POST /v1/me/shelter", { status: 204 });
    await backend.verifyShelter("Fundación Patitas", "900.123.456-8");
    expect(backend.getSnapshot().users.u_ana).toMatchObject({ shelterName: "Fundación Patitas", shelterStatus: "verified" });
    expect(called("POST /v1/me/shelter")[0]?.body).toEqual({ name: "Fundación Patitas", nit: "900.123.456-8" });
    route("POST /v1/adoptions", { status: 201, body: adoption({ id: "ad_2", owner: { ...owner, id: "u_ana" } }) });
    await expect(
      backend.createAdoption({
        name: "Canela",
        species: "dog",
        sex: "female",
        age: "young",
        size: "medium",
        description: "Juguetona",
        vaccinated: true,
        sterilized: true,
        photos: ["https://x/c.jpg"],
        location: { latitude: 6.24, longitude: -75.59 },
        zone: "Laureles, Medellín",
      }),
    ).resolves.toBe("ad_2");
    expect(called("POST /v1/adoptions")[0]?.body).toMatchObject({ photos: ["https://x/c.jpg"], name: "Canela" });

    route("GET /v1/me/adoptions", { status: 200, body: [adoption({ id: "ad_2", pending: 1 })] });
    await expect(backend.loadMyAdoptions()).resolves.toEqual(["ad_2"]);

    const applicant = { ...owner, id: "u_c", shortName: "Camila" };
    const application = (over: object = {}) => ({
      id: "ap_1",
      adoptionId: "ad_1",
      applicant,
      fullName: "Camila",
      household: 3,
      neighborhood: "Laureles",
      city: "Medellín",
      hadPets: false,
      petsCount: 0,
      reason: "Tenemos patio y mucho tiempo.",
      status: "pending",
      createdAt: "2026-11-01T00:00:00Z",
      ...over,
    });
    route("POST /v1/adoptions/ad_1/apply", {
      status: 201,
      body: application({ adoption: adoption({ myApplication: "pending" }) }),
    });
    route("GET /v1/adoptions/ad_1", { status: 200, body: adoption({ myApplication: "pending" }) });
    await backend.applyToAdoption("ad_1", {
      fullName: "Camila",
      household: 3,
      neighborhood: "Laureles",
      city: "Medellín",
      hadPets: false,
      petsCount: 0,
      reason: "Tenemos patio y mucho tiempo.",
    });
    expect(backend.getSnapshot().adoptionApplications[0]).toMatchObject({ id: "ap_1", applicantId: "u_c", status: "pending" });

    route("GET /v1/me/adoption-applications", { status: 200, body: [application({ status: "accepted", threadId: "dm_9" })] });
    await backend.loadMyApplications();
    expect(backend.getSnapshot().adoptionApplications[0]).toMatchObject({ status: "accepted", threadId: "dm_9" });

    route("GET /v1/adoptions/ad_1/applications", { status: 200, body: [application()] });
    route("POST /v1/adoption-applications/ap_1/accept", { status: 200, body: { threadId: "dm_9" } });
    route("GET /v1/threads/dm_9", { status: 404, body: { error: { code: "not_found" } } });
    await expect(backend.acceptApplication("ap_1")).resolves.toBe("dm_9");
    route("POST /v1/adoption-applications/ap_1/decline", { status: 204 });
    await backend.declineApplication("ap_1");
    expect(backend.getSnapshot().adoptionApplications.find((a) => a.id === "ap_1")?.status).toBe("declined");

    route("POST /v1/adoptions/ad_1/adopted", { status: 204 });
    await backend.markAdopted("ad_1");
    route("POST /v1/adoptions/ad_1/report", { status: 204 });
    await backend.reportAdoption("ad_1", "money", "Pide dinero");
    expect(called("POST /v1/adoptions/ad_1/report")[0]?.body).toEqual({ reason: "money", note: "Pide dinero" });
    route("DELETE /v1/adoptions/ad_2", { status: 204 });
    await backend.withdrawAdoption("ad_2");
    expect(backend.getSnapshot().adoptions.some((a) => a.id === "ad_2")).toBe(false);
  });

  it("busca personas, y la red trae las listas propias con su nombre de usuario", async () => {
    const backend = await loggedIn();
    const person = (id: string, username: string) => ({
      id,
      shortName: id,
      username,
      avatar: "dog",
      verified: true,
      createdAt: "2026-01-01T00:00:00Z",
      lang: "es",
    });
    route("GET /v1/users/search?q=%40ana", { status: 200, body: [person("u_x", "ana_gomez")] });
    const found = await backend.searchUsers("@ana");
    expect(found.map((u) => u.username)).toEqual(["ana_gomez"]);

    route("GET /v1/me/network", {
      status: 200,
      body: {
        requests: [person("u_r", "pide")],
        followers: [person("u_f", "sigue")],
        following: [person("u_g", "sigo"), person("u_h", "tambien")],
        sent: [person("u_s", "espera")],
      },
    });
    await backend.loadNetwork();
    let state = backend.getSnapshot();
    expect(state.network).toEqual({ requests: ["u_r"], followers: ["u_f"], following: ["u_g", "u_h"], sent: ["u_s"] });
    expect(state.users.u_r?.username).toBe("pide");
    expect(state.followInfo.u_ana).toEqual({ followers: 1, following: 2, status: "none" });

    route("POST /v1/me/followers/u_r/accept", { status: 204 });
    await backend.acceptFollower("u_r");
    expect(called("POST /v1/me/followers/u_r/accept")).toHaveLength(1);
    route("DELETE /v1/me/followers/u_f", { status: 204 });
    await backend.removeFollower("u_f");
    expect(called("DELETE /v1/me/followers/u_f")).toHaveLength(1);

    const { email: _email, ...publicUser } = user({ id: "u_t", name: "Tercera" });
    route("GET /v1/users/u_t", {
      status: 200,
      body: {
        user: publicUser,
        likes: 0,
        likedByMe: false,
        rating: 4.75,
        ratingCount: 3,
        followers: 7,
        following: 2,
        followStatus: "pending",
        badges: [],
        pets: [],
      },
    });
    route("POST /v1/users/u_t/follow", { status: 200, body: { status: "pending" } });
    await expect(backend.followUser("u_t")).resolves.toBe("pending");
    state = backend.getSnapshot();
    expect(state.followInfo.u_t).toEqual({ followers: 7, following: 2, status: "pending" });
    expect(state.remoteRatings.u_t).toEqual({ average: 4.75, count: 3 });
    route("DELETE /v1/users/u_t/follow", { status: 204 });
    await backend.unfollowUser("u_t");
    expect(called("DELETE /v1/users/u_t/follow")).toHaveLength(1);
  });

  it("explica por qué no se pudo enviar la solicitud", async () => {
    const backend = await loggedIn();
    route("POST /v1/users/u_t/follow", { status: 409, body: { error: { code: "follow_wait" } } });
    await expect(backend.followUser("u_t")).rejects.toMatchObject({ code: "follow_wait" });
  });

  it("ignora las insignias que esta versión de la app todavía no conoce", async () => {
    const backend = await loggedIn();
    const { email: _email, ...publicUser } = user({ id: "u_n", name: "Nueva" });
    route("GET /v1/users/u_n", {
      status: 200,
      body: {
        user: publicUser,
        likes: 0,
        likedByMe: false,
        rating: 5,
        ratingCount: 0,
        followers: 0,
        following: 0,
        followStatus: "none",
        badges: [
          { id: "verified", tier: 1 },
          { id: "del_futuro", tier: 1 },
        ],
        pets: [],
      },
    });
    await backend.loadProfile("u_n");
    expect(userBadgeProgress(backend.getSnapshot(), "u_n").map((b) => b.id)).toEqual(["verified"]);
  });

  it("reporta a una persona y carga su perfil público sin datos privados", async () => {
    const backend = await loggedIn();
    await backend.reportUser({ userId: "u_carlos", reason: "spam" as never, note: "x" });
    expect(called("POST /v1/users/u_carlos/report")[0]?.body).toMatchObject({ reason: "spam", note: "x" });
    const { email: _email, ...publicUser } = user({ id: "u_carlos", name: "Carlos" });
    route("GET /v1/users/u_carlos", {
      status: 200,
      body: {
        user: publicUser,
        likes: 1,
        likedByMe: false,
        badges: [{ id: "verified", tier: 1 }],
        pets: [
          { id: "p1", name: "Toby", species: "dog", photo: "https://x/t.jpg" },
          { id: "p2", name: "Mia", species: "cat" },
        ],
      },
    });
    await backend.loadProfile("u_carlos");
    const state = backend.getSnapshot();
    expect(state.users.u_carlos).toMatchObject({ name: "Carlos", email: "" });
    expect(state.remoteBadges.u_carlos).toHaveLength(1);
    expect(state.ownedPets.map((p) => p.photos)).toEqual([["https://x/t.jpg"], []]);
    expect(state.profileLikes.u_carlos).toHaveLength(1);
  });

  it("en el perfil propio conserva correo y mascotas", async () => {
    route("GET /v1/me/owned-pets", { status: 200, body: [{ id: "own", ownerId: "u_ana" }] });
    const backend = await loggedIn();
    const { email: _email, ...publicUser } = user();
    route("GET /v1/users/u_ana", { status: 200, body: { user: publicUser, likes: 2, likedByMe: true, badges: [], pets: [] } });
    await backend.loadProfile("u_ana");
    expect(backend.currentUser?.email).toBe("ana@x.co");
    expect(backend.getSnapshot().ownedPets).toHaveLength(1);
  });

  it("carga las historias cercanas reemplazando las de esos casos", async () => {
    const backend = await loggedIn();
    route(`GET /v1/stories?lat=${LAURELES.latitude}&lng=${LAURELES.longitude}`, {
      status: 200,
      body: [{ pet: pet("max"), items: [{ id: "s1", petId: "max" }] }],
    });
    await backend.loadStories(LAURELES);
    await backend.loadStories(LAURELES);
    expect(backend.getSnapshot().stories).toEqual([{ id: "s1", petId: "max" }]);
    expect(backend.getPet("max")).toBeDefined();
  });

  it("avisa a quienes escuchan y deja de hacerlo al desuscribirse", async () => {
    const backend = await loggedIn();
    const listener = jest.fn();
    const off = backend.subscribe(listener);
    emit("pet", pet("max"));
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    off();
    emit("pet", pet("luna"));
    expect(listener).not.toHaveBeenCalled();
  });
});
