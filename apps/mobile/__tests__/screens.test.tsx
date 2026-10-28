/**
 * Pruebas de pantallas y acciones secundarias (perfil, ajustes, avistamientos, reencuentro,
 * contacto, soporte) sobre el router real con el backend de demostración.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Share } from "react-native";

import { STORAGE_KEYS } from "@/services/storage";

const loginAs = async (userId: string) => AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(userId));

async function open(url: string) {
  const pending = renderRouter("./app", { initialUrl: url });
  await pending;
  return { getPathname: () => (pending as unknown as { getPathname: () => string }).getPathname() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
});

describe("perfil", () => {
  it("invita a crear cuenta sin sesión", async () => {
    await open("/profile");
    expect(await screen.findByText("Únete a la comunidad")).toBeOnTheScreen();
  });

  it("muestra identidad, estadísticas reales, insignias y cierra sesión", async () => {
    await loginAs("u_valentina");
    const app = await open("/profile");
    expect(await screen.findByText("Valentina Arango")).toBeOnTheScreen();
    expect(screen.getByLabelText("Cuenta verificada")).toBeOnTheScreen();
    expect(screen.getByText("@valentina")).toBeOnTheScreen();
    expect(screen.getByLabelText("7 Me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByText("Ver todas")[0]!);
    expect(await screen.findByText("Todas las insignias")).toBeOnTheScreen();
    expect(screen.getByText("Publica 5 reportes.")).toBeOnTheScreen();
    expect(screen.getByText("2 de 5 para Plata")).toBeOnTheScreen();
    expect(screen.getByTestId("member-days")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("logout"));
    await fireEvent.press(await screen.findAllByText("Cerrar sesión").then((all) => all[all.length - 1]!));
    await waitFor(() => expect(app.getPathname()).toBe("/"));
  });
});

describe("listas", () => {
  it("muestra mis reportes, los casos que sigo y los cercanos", async () => {
    await loginAs("u_valentina");
    await open("/list?filter=mine");
    expect(await screen.findByText("Mis reportes")).toBeOnTheScreen();
    expect(screen.getByTestId("pet-row-rocky")).toBeOnTheScreen();
  });

  it("explica cómo seguir casos cuando no hay ninguno", async () => {
    await open("/list?filter=following");
    expect(await screen.findByText("Toca el corazón en un reporte para seguir el caso y recibir novedades.")).toBeOnTheScreen();
  });

  it("seguir un caso desde la tarjeta lo agrega a la lista", async () => {
    await open("/");
    await fireEvent.press(await screen.findByTestId("favorite-max"));
    expect(screen.getByLabelText("Dejar de seguir el caso de Max")).toBeOnTheScreen();
  });
});

describe("detalle del caso", () => {
  it("reporta un avistamiento que actualiza el último punto", async () => {
    await loginAs("u_valentina");
    await open("/pet/toby");
    await fireEvent.press(await screen.findByTestId("saw-it"));
    expect(await screen.findByText("Reportar avistamiento")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("sighting-submit"));
    expect(await screen.findByText("Marca en el mapa dónde fue vista.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("sighting-locate"));
    await waitFor(() => expect(screen.getByDisplayValue("Laureles, Medellín")).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("sighting-submit"));
    expect(await screen.findByText("¡Gracias! Avisamos a la familia y al grupo del caso.")).toBeOnTheScreen();
  });

  it("la familia marca el reencuentro y el caso queda archivado", async () => {
    await loginAs("u_valentina");
    await open("/pet/rocky");
    await fireEvent.press(await screen.findByTestId("reunite"));
    await fireEvent.press(await screen.findByText("Sí, ¡ya está en casa!"));
    expect(await screen.findAllByText("¡Rocky ya está en casa! Este caso está archivado.")).not.toHaveLength(0);
    expect(screen.queryByTestId("reunite")).not.toBeOnTheScreen();
  });

  it("abre el chat directo con la familia y comparte el caso", async () => {
    await loginAs("u_valentina");
    await open("/pet/simba");
    await fireEvent.press(await screen.findByTestId("share"));
    expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining("https://pawfound.app/mascota/simba") });
    expect(
      await screen.findByText("¡Gracias por compartir! Cada persona que lo ve aumenta las posibilidades."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("contact"));
    expect(await screen.findByTestId("chat-screen")).toBeOnTheScreen();
    expect(screen.getByText(/Nunca pagues por adelantado/)).toBeOnTheScreen();
  });

  it("permite reportar la publicación desde más opciones", async () => {
    await loginAs("u_valentina");
    await open("/pet/max");
    await fireEvent.press(await screen.findByTestId("more"));
    await fireEvent.press(await screen.findByText("Reportar publicación"));
    expect(await screen.findByText("Gracias. Nuestro equipo revisará la publicación.")).toBeOnTheScreen();
  });

  it("muestra un estado claro si el caso no existe", async () => {
    await open("/mascota/no-existe");
    expect(await screen.findByText("No encontramos este reporte. Puede haber sido archivado o eliminado.")).toBeOnTheScreen();
  });
});

describe("cuentas sin teléfono", () => {
  it("login social para reportar pide verificar el celular", async () => {
    const app = await open("/auth/login?next=/report");
    await fireEvent.press(await screen.findByTestId("social-google"));
    await waitFor(() => expect(app.getPathname()).toBe("/auth/phone"));
    await fireEvent.changeText(screen.getByTestId("phone-input"), "123");
    await fireEvent.press(screen.getByTestId("phone-submit"));
    expect(await screen.findByText("Escribe un celular colombiano válido (ej. 300 123 4567)")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("phone-input"), "320 555 1234");
    await fireEvent.press(screen.getByTestId("phone-submit"));
    await waitFor(() => expect(app.getPathname()).toBe("/auth/verify"));
  });
});

describe("ajustes", () => {
  it("cambia preferencias de notificaciones y muestra el horario de descanso", async () => {
    await loginAs("u_valentina");
    await open("/settings/notifications");
    await fireEvent(await screen.findByTestId("pref-lost"), "valueChange", false);
    await fireEvent(screen.getByLabelText("Modo descanso"), "valueChange", true);
    expect(await screen.findByLabelText(/Desde/)).toBeOnTheScreen();
  });

  it("elige quién puede escribir y exporta los datos", async () => {
    await loginAs("u_valentina");
    await open("/settings/privacy");
    await fireEvent.press(await screen.findByTestId("who-can-message"));
    await fireEvent.press(await screen.findByRole("radio", { name: "Solo cuentas verificadas" }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Quién puede enviarme mensajes.*Solo cuentas verificadas/)).toBeOnTheScreen(),
    );
    await fireEvent.press(screen.getByTestId("export-data"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('"u_valentina"') }));
  });

  it("busca en la ayuda, expande respuestas y envía un mensaje a soporte sin necesitar cuenta", async () => {
    await open("/settings/support");
    await fireEvent.changeText(await screen.findByTestId("faq-search"), "estafas");
    expect(screen.getByText("¿Cómo evito estafas?")).toBeOnTheScreen();
    expect(screen.queryByText("¿Cómo me uno a un grupo?")).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("faq-7"));
    expect(await screen.findByText(/Nunca pagues por adelantado\. Desconfía/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("contact-reportBug"));
    await fireEvent.changeText(await screen.findByTestId("support-message"), "El mapa no carga en mi barrio");
    await fireEvent.press(screen.getByTestId("support-send"));
    expect(await screen.findByText(/Te responderemos en menos de 24 horas/)).toBeOnTheScreen();
  });

  it("navega entre secciones de ajustes", async () => {
    await loginAs("u_valentina");
    const app = await open("/settings/support");
    await fireEvent.press(await screen.findByTestId("settings-nav-privacy"));
    await waitFor(() => expect(app.getPathname()).toBe("/settings/privacy"));
  });
});

describe("mapa", () => {
  it("pide consentimiento propio antes de usar la ubicación y activa la capa de círculos", async () => {
    await open("/map");
    await fireEvent.press(await screen.findByTestId("locate-me"));
    expect(await screen.findByText(/Autorizo a PawFound a usar mi ubicación aproximada/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("consent-allow"));
    await fireEvent.press(screen.getByTestId("layers"));
    await fireEvent(await screen.findByTestId("toggle-life-circles"), "valueChange", true);
    expect(screen.getByLabelText("Círculos de vida")).toBeOnTheScreen();
  });
});
