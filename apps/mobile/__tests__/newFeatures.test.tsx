/**
 * Funciones nuevas: fotos en el chat (DM y grupos), historia para Instagram que no se pierde a
 * las 24 horas (Destacadas + aviso al cerrar) y "¿Es tu mascota?" en Mis mascotas.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { captureRef } from "react-native-view-shot";

import { STORAGE_KEYS } from "@/services/storage";

const loginAs = async (userId: string) => AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(userId));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("fotos en el chat", () => {
  it("adjunta una foto de la galería, la envía y se abre completa", async () => {
    await loginAs("u_valentina");
    await renderRouter("./app", { initialUrl: "/chat/dm_maria" });
    await fireEvent.press(await screen.findByTestId("chat-attach"));
    await fireEvent.press(await screen.findByTestId("chat-photo-library"));
    expect(await screen.findByTestId("chat-photo-preview")).toBeOnTheScreen();
    expect(screen.getAllByText("La foto se envía sin ubicación ni datos de tu celular.").length).toBeGreaterThan(0);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ exif: false }));

    await fireEvent.press(screen.getByTestId("chat-send"));
    const bubble = await screen.findByLabelText("Foto de Tú. Toca para verla completa");
    expect(screen.queryByTestId("chat-photo-preview")).toBeNull();
    await fireEvent.press(bubble);
    expect(await screen.findByTestId("photo-viewer")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("photo-viewer-close"));
  });

  it("se puede tomar con la cámara y quitar antes de enviar", async () => {
    await loginAs("u_valentina");
    await renderRouter("./app", { initialUrl: "/chat/dm_maria" });
    await fireEvent.press(await screen.findByTestId("chat-attach"));
    await fireEvent.press(await screen.findByTestId("chat-photo-camera"));
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId("chat-photo-remove"));
    expect(screen.queryByTestId("chat-photo-preview")).toBeNull();
  });

  it("sin permiso de fotos, explica por qué no puede adjuntar", async () => {
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await loginAs("u_valentina");
    await renderRouter("./app", { initialUrl: "/chat/dm_maria" });
    await fireEvent.press(await screen.findByTestId("chat-attach"));
    await fireEvent.press(await screen.findByTestId("chat-photo-library"));
    expect(screen.queryByTestId("chat-photo-preview")).toBeNull();
  });
});

describe("historia para Instagram", () => {
  it("crea la imagen vertical 1080×1920, copia el enlace y cuenta como compartido", async () => {
    await loginAs("u_valentina");
    await renderRouter("./app", { initialUrl: "/pet/max/story" });
    expect(await screen.findByTestId("story-canvas")).toBeOnTheScreen();
    expect(screen.getByText("SE BUSCA")).toBeOnTheScreen();
    expect(screen.getByText(/Guárdala en tus Destacadas/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("story-share"));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///poster.png", expect.objectContaining({ mimeType: "image/png" })),
    );
    expect(captureRef).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 1080, height: 1920 }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining("/max"));
    expect(await screen.findByText("¡Gracias por compartir!")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("story-copy"));
    expect(await screen.findByText(/Enlace copiado/)).toBeOnTheScreen();
  });

  it("cuando la mascota ya volvió a casa, la historia es la buena noticia", async () => {
    await renderRouter("./app", { initialUrl: "/pet/canela/story" });
    expect(await screen.findByText("¡YA ESTÁ EN CASA!")).toBeOnTheScreen();
    expect(screen.getByText("Compartir la buena noticia")).toBeOnTheScreen();
    expect(screen.getByText(/Quita la historia anterior/)).toBeOnTheScreen();
  });

  it("si no se puede compartir, lo dice", async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    await renderRouter("./app", { initialUrl: "/pet/max/story" });
    await fireEvent.press(await screen.findByTestId("story-share"));
    expect(await screen.findByText("No pudimos crear la imagen. Intenta de nuevo.")).toBeOnTheScreen();
  });

  it("se abre desde el detalle del caso", async () => {
    await renderRouter("./app", { initialUrl: "/pet/max" });
    await fireEvent.press(await screen.findByTestId("story"));
    expect(await screen.findByTestId("story-screen")).toBeOnTheScreen();
  });

  it("un caso inexistente muestra el estado vacío", async () => {
    await renderRouter("./app", { initialUrl: "/pet/nada/story" });
    expect(await screen.findByText(/No encontramos/)).toBeOnTheScreen();
  });
});

describe("¿Es tu mascota? en Mis mascotas", () => {
  it("muestra las encontradas que se parecen a Coco", async () => {
    await loginAs("u_valentina");
    await renderRouter("./app", { initialUrl: "/my-pets" });
    expect(await screen.findByTestId("matches-own_coco")).toBeOnTheScreen();
    expect(screen.getByText("1 mascota encontrada se parece a Coco")).toBeOnTheScreen();
    expect(screen.queryByTestId("matches-own_rocky")).toBeNull();
    expect(screen.queryByTestId("matches-need-zone")).toBeNull();
  });
});

describe("alertas en el registro", () => {
  it("pide el permiso de notificaciones con su porqué y deja continuar", async () => {
    const Notifications = jest.requireMock("expo-notifications") as {
      getPermissionsAsync: jest.Mock;
      requestPermissionsAsync: jest.Mock;
    };
    Notifications.getPermissionsAsync.mockResolvedValueOnce({ status: "undetermined" });
    await loginAs("u_valentina");
    await renderRouter("./app", { initialUrl: "/auth/alerts?next=/messages" });
    expect(await screen.findByText("Activa tus alertas")).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId("push-permission"));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("alerts-continue"));
    expect(await screen.findByTestId("messages-screen")).toBeOnTheScreen();
  });
});
