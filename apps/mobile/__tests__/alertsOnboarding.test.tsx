/**
 * "Activa tus alertas": dos filas y un botón, y qué pasa si la persona no da los permisos.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking } from "react-native";

import { STORAGE_KEYS } from "@/services/storage";

const foreground = jest.mocked(Location.getForegroundPermissionsAsync);
const requestForeground = jest.mocked(Location.requestForegroundPermissionsAsync);
const requestBackground = jest.mocked(Location.requestBackgroundPermissionsAsync);
const started = jest.mocked(Location.hasStartedLocationUpdatesAsync);
const pushStatus = jest.mocked(Notifications.getPermissionsAsync);
const pushRequest = jest.mocked(Notifications.requestPermissionsAsync);
const allow = { status: "granted" } as never;
const deny = { status: "denied" } as never;
const ask = { status: "undetermined" } as never;

async function open() {
  await AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify("u_sebastian"));
  await renderRouter("./app", { initialUrl: "/auth/alerts?next=/messages" });
  await screen.findByTestId("alerts-onboarding");
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  pushStatus.mockResolvedValue(ask);
  pushRequest.mockResolvedValue(allow);
  foreground.mockResolvedValue(ask);
  requestForeground.mockResolvedValue(allow);
  requestBackground.mockResolvedValue(allow);
  started.mockResolvedValue(false);
});

afterAll(() => {
  pushStatus.mockReset();
  foreground.mockResolvedValue(ask);
  started.mockResolvedValue(false);
});

describe("activar las alertas", () => {
  it("explica para qué es cada permiso y, con un toque, los pide todos", async () => {
    await open();
    expect(screen.getByTestId("alerts-row-push")).toHaveTextContent(/recibir el aviso/i);
    expect(screen.getByTestId("alerts-row-location")).toHaveTextContent(/permitir todo el tiempo/i);
    expect(screen.getByTestId("alerts-privacy")).toHaveTextContent(/también con la app cerrada/);

    foreground.mockResolvedValue(allow);
    await fireEvent.press(screen.getByTestId("alerts-activate"));
    await waitFor(() => expect(pushRequest).toHaveBeenCalled());
    expect(requestForeground).toHaveBeenCalled();
    expect(requestBackground).toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalled();
  });

  it("con todo activo solo queda continuar", async () => {
    pushStatus.mockResolvedValue(allow);
    foreground.mockResolvedValue(allow);
    started.mockResolvedValue(true);
    await open();
    pushRequest.mockResolvedValue(allow);
    await fireEvent.press(await screen.findByTestId("alerts-activate"));
    await waitFor(() => expect(screen.queryByTestId("alerts-privacy")).not.toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("alerts-continue"));
    expect(await screen.findByTestId("messages-screen")).toBeOnTheScreen();
  });

  it("si las notificaciones están bloqueadas, lleva a los ajustes del celular", async () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
    pushStatus.mockResolvedValue(deny);
    await open();
    expect(await screen.findByTestId("alerts-settings")).toBeOnTheScreen();
    expect(screen.getByTestId("alerts-row-push")).toHaveTextContent(/bloqueadas/i);
    await fireEvent.press(screen.getByTestId("alerts-settings"));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it("sin permiso de ubicación lo dice y deja seguir sin alertas", async () => {
    requestForeground.mockResolvedValue(deny);
    await open();
    await fireEvent.press(await screen.findByTestId("alerts-activate"));
    expect(await screen.findByTestId("alerts-settings")).toBeOnTheScreen();
    expect(screen.getByTestId("alerts-row-location")).toHaveTextContent(/sin permiso/i);
    expect(screen.getByText("No recibirás alertas de mascotas perdidas")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("alerts-continue"));
    expect(await screen.findByTestId("messages-screen")).toBeOnTheScreen();
  });

  it("si solo permite con la app abierta, explica cómo mejorarlo", async () => {
    requestBackground.mockResolvedValue(deny);
    foreground.mockResolvedValue(allow);
    await open();
    await fireEvent.press(await screen.findByTestId("alerts-activate"));
    await waitFor(() => expect(screen.getByTestId("alerts-row-location")).toHaveTextContent(/solo con la app abierta/i));
    expect(screen.getByText(/Permitir todo el tiempo/)).toBeOnTheScreen();
    expect(screen.getByTestId("alerts-settings")).toBeOnTheScreen();
  });
});
