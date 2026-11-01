import * as Location from "expo-location";
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
} from "../alertLocation";
import { directionsUrl, navigationApps, vetSearchUrl } from "../directions";
import { photoExists, shrinkPhoto } from "../photoShrink";

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
