import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Image } from "react-native";

import { errorMessage } from "@/features/errorMessages";

import {
  ALERT_LOCATION_TASK,
  alertLocationMode,
  currentPoint,
  setAlertLocationSink,
  startAlertLocation,
  stopAlertLocation,
  syncAlertLocation,
} from "../alertLocation";
import { directionsUrl, navigationApps, vetSearchUrl } from "../directions";
import { photoExists, shrinkPhoto } from "../photoShrink";
import { ME_KEY, TOKENS_KEY } from "../sessionKeys";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

jest.mock("@/config", () => ({ ...jest.requireActual("@/config"), API_URL: "https://api.test" }));

const mockContext = {
  resize: jest.fn(),
  renderAsync: jest.fn(async () => ({ saveAsync: jest.fn(async () => ({ uri: "file:///chica.jpg" })) })),
};

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: jest.fn(() => mockContext) },
  SaveFormat: { JPEG: "jpeg" },
}));

const point = { latitude: 6.24, longitude: -75.59 };
const granted = { status: "granted" } as never;
const denied = { status: "denied" } as never;

// defineTask corre al importar el módulo: se guarda antes de que una prueba limpie los mocks.
const taskCall = jest.mocked(TaskManager.defineTask).mock.calls[0];

describe("rutas a un destino", () => {
  it("Mapas de Apple solo se ofrece en iPhone", () => {
    expect(navigationApps("android")).toEqual(["google", "waze"]);
    expect(navigationApps("ios")).toEqual(["google", "waze", "apple"]);
  });

  it("el enlace lleva solo el destino, nunca la ubicación de quien lo abre", () => {
    expect(directionsUrl("google", point)).toBe("https://www.google.com/maps/dir/?api=1&destination=6.24,-75.59");
    expect(directionsUrl("waze", point)).toBe("https://waze.com/ul?ll=6.24,-75.59&navigate=yes");
    expect(directionsUrl("apple", point)).toBe("https://maps.apple.com/?daddr=6.24,-75.59");
    expect(directionsUrl("apple", point, "Vet & Co")).toContain("&q=Vet%20%26%20Co");
  });

  it("codifica la búsqueda de veterinarias", () => {
    expect(vetSearchUrl("veterinaria 24 h")).toContain("query=veterinaria%2024%20h");
  });
});

describe("mensajes de error", () => {
  it.each([
    ["network", "errors.network"],
    ["provider_unavailable", "errors.email_unavailable"],
    ["rate_limited", "errors.rate_limited"],
    ["suspended", "errors.suspended"],
    ["invalid_input", "errors.invalid_input"],
    ["storage_unavailable", "errors.storage_unavailable"],
    ["invalid_image", "errors.invalid_image"],
    ["not_found", "errors.unknown"],
  ] as const)("%s dice qué pasó", (code, key) => {
    expect(errorMessage(code, (k) => k)).toBe(key);
  });
});

describe("fotos antes de subirlas", () => {
  const sized = (width: number, height: number) =>
    jest.spyOn(Image, "getSize").mockImplementation((_uri, ok) => {
      ok?.(width, height);
      return undefined as never;
    });

  afterEach(() => {
    jest.restoreAllMocks();
    mockContext.resize.mockClear();
  });

  it("reduce por el lado mayor, sin agrandar las pequeñas", async () => {
    sized(4000, 3000);
    await expect(shrinkPhoto("file:///a.jpg")).resolves.toBe("file:///chica.jpg");
    expect(mockContext.resize).toHaveBeenLastCalledWith({ width: 1600 });

    sized(3000, 4000);
    await shrinkPhoto("file:///b.jpg");
    expect(mockContext.resize).toHaveBeenLastCalledWith({ height: 1600 });

    mockContext.resize.mockClear();
    sized(800, 600);
    await shrinkPhoto("file:///c.jpg");
    expect(mockContext.resize).not.toHaveBeenCalled();
  });

  it("si no se puede achicar, sube la foto tal cual", async () => {
    jest.spyOn(Image, "getSize").mockImplementation((_uri, _ok, fail) => {
      fail?.(new Error("no se puede leer"));
      return undefined as never;
    });
    await expect(shrinkPhoto("file:///a.jpg")).resolves.toBe("file:///a.jpg");
  });

  it("una foto de un borrador viejo que Android borró ya no existe", async () => {
    await expect(photoExists("https://x/f.jpg")).resolves.toBe(true);
    sized(10, 10);
    await expect(photoExists("file:///a.jpg")).resolves.toBe(true);
    jest.spyOn(Image, "getSize").mockImplementation((_uri, _ok, fail) => {
      fail?.(new Error("borrada"));
      return undefined as never;
    });
    await expect(photoExists("file:///a.jpg")).resolves.toBe(false);
  });
});

describe("el punto del GPS con la app cerrada", () => {
  const task = () => taskCall?.[1] as (input: unknown) => Promise<void>;
  const moved = { data: { locations: [{ coords: point }] }, error: null };
  const session = async (zone: string | null = "Laureles") => {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify({ access: "a1", refresh: "r1" }));
    await AsyncStorage.setItem(ME_KEY, JSON.stringify({ alertZone: zone ? { zone } : null }));
  };
  const reply = (status: number, body: unknown = null) => ({ status, ok: status < 300, json: async () => body }) as Response;
  const fetchMock = jest.fn();
  const started = jest.mocked(Location.hasStartedLocationUpdatesAsync);
  const stop = jest.mocked(Location.stopLocationUpdatesAsync);

  beforeEach(async () => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    stop.mockClear();
    started.mockResolvedValue(true);
    setAlertLocationSink(null);
    await SecureStore.deleteItemAsync(TOKENS_KEY);
    await AsyncStorage.clear();
  });

  it("con la sesión guardada envía el punto, sin necesitar la app abierta", async () => {
    await session();
    fetchMock.mockResolvedValueOnce(reply(200));
    await task()(moved);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/me/location");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer a1");
    expect(JSON.parse(init.body as string)).toEqual({ location: point, zone: "Laureles" });
    expect(stop).not.toHaveBeenCalled();
  });

  it("con el token vencido lo renueva, lo guarda y repite el envío", async () => {
    await session();
    fetchMock.mockResolvedValueOnce(reply(401));
    fetchMock.mockResolvedValueOnce(reply(200, { accessToken: "a2", refreshToken: "r2" }));
    fetchMock.mockResolvedValueOnce(reply(200));
    await task()(moved);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.test/v1/auth/refresh");
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer a2" });
    expect(JSON.parse((await SecureStore.getItemAsync(TOKENS_KEY)) ?? "{}")).toEqual({ access: "a2", refresh: "r2" });
  });

  it("sin sesión o con las alertas apagadas deja de seguir la ubicación", async () => {
    await task()(moved);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    await session(null);
    await task()(moved);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("si la API rechaza la sesión deja de seguirla, pero un fallo temporal no", async () => {
    await session();
    fetchMock.mockResolvedValueOnce(reply(401));
    fetchMock.mockResolvedValueOnce(reply(503));
    await task()(moved);
    expect(stop).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(reply(401));
    fetchMock.mockResolvedValueOnce(reply(401));
    await task()(moved);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await SecureStore.getItemAsync(TOKENS_KEY)).not.toBeNull();
  });

  it("sin red no falla la tarea", async () => {
    await session();
    fetchMock.mockRejectedValueOnce(new Error("sin red"));
    await expect(task()(moved)).resolves.toBeUndefined();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("ubicación para la Alerta Ángel", () => {
  const foreground = jest.mocked(Location.requestForegroundPermissionsAsync);
  const background = jest.mocked(Location.requestBackgroundPermissionsAsync);
  const currentPermission = jest.mocked(Location.getForegroundPermissionsAsync);
  const started = jest.mocked(Location.hasStartedLocationUpdatesAsync);
  const updates = jest.mocked(Location.startLocationUpdatesAsync);
  const stop = jest.mocked(Location.stopLocationUpdatesAsync);
  const lastKnown = jest.mocked(Location.getLastKnownPositionAsync);
  const position = jest.mocked(Location.getCurrentPositionAsync);

  beforeEach(() => {
    foreground.mockResolvedValue(granted);
    background.mockResolvedValue(granted);
    currentPermission.mockResolvedValue(granted);
    started.mockResolvedValue(false);
    updates.mockClear();
    stop.mockClear();
  });

  it("sin permiso queda apagada; sin el de segundo plano, solo al abrir la app", async () => {
    foreground.mockResolvedValueOnce(denied);
    await expect(startAlertLocation()).resolves.toBe("off");
    background.mockResolvedValueOnce(denied);
    await expect(startAlertLocation()).resolves.toBe("foreground");
    expect(updates).not.toHaveBeenCalled();
  });

  it("con todos los permisos sigue cada 250 m, en segundo plano", async () => {
    await expect(startAlertLocation()).resolves.toBe("always");
    expect(updates).toHaveBeenCalledWith(ALERT_LOCATION_TASK, expect.objectContaining({ distanceInterval: 250 }));
  });

  it("donde no se permite el segundo plano, funciona al abrir la app", async () => {
    updates.mockRejectedValueOnce(new Error("no disponible"));
    await expect(startAlertLocation()).resolves.toBe("foreground");
  });

  it("detiene el seguimiento solo si estaba activo, y no falla si no existía", async () => {
    await stopAlertLocation();
    expect(stop).not.toHaveBeenCalled();
    started.mockResolvedValueOnce(true);
    await stopAlertLocation();
    expect(stop).toHaveBeenCalledWith(ALERT_LOCATION_TASK);
    started.mockRejectedValueOnce(new Error("sin tarea"));
    await expect(stopAlertLocation()).resolves.toBeUndefined();
  });

  it("con el permiso ya dado en Android inicia el seguimiento, sin preguntar", async () => {
    const backgroundStatus = jest.mocked(Location.getBackgroundPermissionsAsync);
    backgroundStatus.mockResolvedValueOnce(denied);
    await expect(syncAlertLocation()).resolves.toBe("foreground");
    expect(updates).not.toHaveBeenCalled();

    backgroundStatus.mockResolvedValueOnce(granted);
    await expect(syncAlertLocation()).resolves.toBe("always");
    expect(updates).toHaveBeenCalledWith(ALERT_LOCATION_TASK, expect.objectContaining({ distanceInterval: 250 }));

    currentPermission.mockResolvedValueOnce(denied);
    await expect(syncAlertLocation()).resolves.toBe("off");
    started.mockResolvedValueOnce(true);
    await expect(syncAlertLocation()).resolves.toBe("always");
    backgroundStatus.mockRejectedValueOnce(new Error("falla"));
    await expect(syncAlertLocation()).resolves.toBe("foreground");
  });

  it("informa el modo actual", async () => {
    currentPermission.mockResolvedValueOnce(denied);
    await expect(alertLocationMode()).resolves.toBe("off");
    await expect(alertLocationMode()).resolves.toBe("foreground");
    started.mockResolvedValueOnce(true);
    await expect(alertLocationMode()).resolves.toBe("always");
    currentPermission.mockRejectedValueOnce(new Error("falla"));
    await expect(alertLocationMode()).resolves.toBe("off");
  });

  it("el punto actual necesita permiso y prefiere la última posición conocida", async () => {
    currentPermission.mockResolvedValueOnce(denied);
    await expect(currentPoint()).resolves.toBeNull();
    lastKnown.mockResolvedValueOnce({ coords: point } as never);
    await expect(currentPoint()).resolves.toEqual(point);
    lastKnown.mockResolvedValueOnce(null);
    position.mockRejectedValueOnce(new Error("sin GPS"));
    await expect(currentPoint()).resolves.toBeNull();
  });

  it("la tarea entrega solo el último punto y solo si hay quién lo reciba", async () => {
    expect(taskCall?.[0]).toBe(ALERT_LOCATION_TASK);
    const task = taskCall?.[1] as (input: unknown) => Promise<void>;
    const sink = jest.fn();
    const moved = { data: { locations: [{ coords: { latitude: 1, longitude: 1 } }, { coords: point }] }, error: null };

    setAlertLocationSink(null);
    await task(moved);
    setAlertLocationSink(sink);
    await task({ data: { locations: [] }, error: null });
    await task({ data: moved.data, error: new Error("falla") });
    expect(sink).not.toHaveBeenCalled();

    await task(moved);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(point);
    setAlertLocationSink(null);
  });
});
