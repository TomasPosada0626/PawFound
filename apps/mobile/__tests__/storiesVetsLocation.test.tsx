/**
 * Historias, veterinarias y ubicación compartida en el chat, sobre el router real con el backend
 * de demostración.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { render, screen as rendered } from "@testing-library/react-native";
import { Linking } from "react-native";

import { LocationCard } from "@/components/LocationCard";
import type { Message, MessageLocation } from "@/domain/types";
import { es } from "@/i18n/es";
import { I18nProvider } from "@/i18n/I18nProvider";
import { STORAGE_KEYS } from "@/services/storage";
import { ThemeProvider } from "@/theme/ThemeProvider";

const loginAs = async (userId: string) => AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(userId));

async function open(url: string) {
  const pending = renderRouter("./app", { initialUrl: url });
  await pending;
  return { getPathname: () => (pending as unknown as { getPathname: () => string }).getPathname() };
}

let openURL: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
});

afterEach(() => openURL.mockRestore());

describe("historias", () => {
  it("una historia que ya no está lo explica, sin pantalla en blanco", async () => {
    await open("/historias/no-existe");
    expect(await screen.findByTestId("story-viewer-empty")).toBeOnTheScreen();
    expect(screen.getByText(es.stories.gone)).toBeOnTheScreen();
  });

  it("sin cuenta se puede ver, avanzar, retroceder e ir al caso", async () => {
    const app = await open("/historias/max");
    expect(await screen.findByTestId("story-viewer")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("story-next"));
    await fireEvent.press(screen.getByTestId("story-prev"));
    expect(screen.queryByTestId("story-add")).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("story-view-case"));
    await waitFor(() => expect(app.getPathname()).toBe("/pet/max"));
  });

  it("la familia agrega una actualización y la quita", async () => {
    await loginAs("u_valentina");
    await open("/historias/rocky");
    await fireEvent.press(await screen.findByTestId("story-add"));
    expect(await screen.findByTestId("story-add-sheet")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("story-add-text"), "Lo vieron por el parque");
    await fireEvent.press(screen.getByTestId("story-publish"));
    expect(await screen.findByText(es.stories.published)).toBeOnTheScreen();
    for (let i = 0; i < 6 && !screen.queryByTestId("story-remove"); i++) {
      await fireEvent.press(screen.getByTestId("story-next"));
    }
    await fireEvent.press(await screen.findByTestId("story-remove"));
    expect(await screen.findByText(es.stories.removed)).toBeOnTheScreen();
  });
});

describe("veterinarias", () => {
  it("lista las 5 más cercanas, numeradas, y abre su ficha", async () => {
    await open("/veterinarias");
    expect(await screen.findByTestId("vets-screen")).toBeOnTheScreen();
    const rows = await screen.findAllByTestId(/^vet-(?!call)/);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(screen.getByText(es.vets.nearest)).toBeOnTheScreen();
    await fireEvent.press(rows[0]!);
    expect(await screen.findByTestId("place-sheet")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("place-go"));
    await fireEvent.press(await screen.findByTestId("directions-google"));
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining("https://www.google.com/maps/dir/"));
  });

  it("reporta un error en los datos de una veterinaria", async () => {
    await loginAs("u_valentina");
    await open("/veterinarias");
    const rows = await screen.findAllByTestId(/^vet-(?!call)/);
    await fireEvent.press(rows[0]!);
    await fireEvent.press(await screen.findByTestId("place-report"));
    await fireEvent.changeText(await screen.findByTestId("place-report-note"), "Ya cerró");
    await fireEvent.press(screen.getByTestId("place-report-send"));
    expect(await screen.findByText(es.places.reported)).toBeOnTheScreen();
  });
});

describe("compartir ubicación en un mensaje directo", () => {
  let back: jest.SpyInstance;
  beforeEach(() => {
    back = jest.spyOn(router, "back").mockImplementation(() => {});
  });
  afterEach(() => back.mockRestore());

  it("no se puede en grupos ni en chats ajenos", async () => {
    await loginAs("u_valentina");
    await open("/chat/ubicacion?thread=grp_max");
    expect(await screen.findByText(es.chat.notFound)).toBeOnTheScreen();
    expect(screen.queryByTestId("share-location")).not.toBeOnTheScreen();
  });

  it("sin cuenta pide entrar", async () => {
    const app = await open("/chat/ubicacion?thread=dm_maria");
    await waitFor(() => expect(app.getPathname()).toBe("/auth/login"));
  });

  it("envía la ubicación actual una sola vez", async () => {
    await loginAs("u_valentina");
    await open("/chat/ubicacion?thread=dm_maria");
    expect(await screen.findByTestId("share-location")).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId("share-location-send")).toBeEnabled());
    await fireEvent.press(screen.getByTestId("share-location-send"));
    await waitFor(() => expect(back).toHaveBeenCalled());
  });

  it("envía un punto de encuentro con nombre", async () => {
    await loginAs("u_valentina");
    await open("/chat/ubicacion?thread=dm_maria");
    await screen.findByTestId("share-location");
    await waitFor(() => expect(screen.getByTestId("share-location-send")).toBeEnabled());
    await fireEvent.press(screen.getByText(es.chatLocation.tabMeeting));
    await fireEvent.changeText(await screen.findByTestId("share-location-label"), "Parque de Laureles");
    await fireEvent.press(screen.getByTestId("share-location-use-mine"));
    await fireEvent.press(screen.getByTestId("share-location-send"));
    await waitFor(() => expect(back).toHaveBeenCalled());
  });
});

describe("tarjeta de ubicación en el chat", () => {
  const point = { latitude: 6.24, longitude: -75.59 };
  const message = (location: MessageLocation): Message =>
    ({
      id: "m1",
      threadId: "dm",
      authorId: "u",
      authorShortName: "Carlos M.",
      kind: "location",
      text: "",
      at: "2026-10-27T12:00:00Z",
      location,
    }) as Message;

  const card = async (location: MessageLocation, mine = false) => {
    const onDirections = jest.fn();
    const onStop = jest.fn();
    await render(
      <I18nProvider>
        <ThemeProvider>
          <LocationCard message={message(location)} mine={mine} onDirections={onDirections} onStop={onStop} />
        </ThemeProvider>
      </I18nProvider>,
    );
    return { onDirections, onStop };
  };

  it("una ubicación oculta no muestra mapa ni coordenadas", async () => {
    await card({ kind: "current", hidden: true, location: point });
    expect(await rendered.findByTestId("location-hidden-m1")).toBeOnTheScreen();
    expect(rendered.queryByTestId("location-m1")).not.toBeOnTheScreen();
  });

  it("de otra persona lleva a cómo llegar, pero no deja de compartirla", async () => {
    const { onDirections } = await card({ kind: "current", location: point });
    await fireEvent.press(await rendered.findByTestId("location-directions-m1"));
    expect(onDirections).toHaveBeenCalledWith({ destination: point, label: undefined });
    expect(rendered.queryByTestId("location-stop-m1")).not.toBeOnTheScreen();
  });

  it("la propia se puede dejar de compartir", async () => {
    const { onStop } = await card({ kind: "meeting", location: point, label: "Parque" }, true);
    await fireEvent.press(await rendered.findByTestId("location-stop-m1"));
    expect(onStop).toHaveBeenCalled();
    expect(rendered.getByText("Parque")).toBeOnTheScreen();
  });

  it("una veterinaria muestra su nombre y dirección", async () => {
    await card({ kind: "place", location: point, label: "VetCare", address: "Calle 10" });
    expect(await rendered.findByText(/VetCare · Calle 10/)).toBeOnTheScreen();
  });
});
