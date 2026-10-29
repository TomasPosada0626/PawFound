/**
 * Flujos de comunidad: Alerta Ángel (ajustes y notificación del sistema), "Mis mascotas",
 * afiche con QR, cierre con agradecimiento ("Ángel de patas"), insignias y convivencia
 * (reportar en vez de bloquear, aviso amable antes de enviar).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { STORAGE_KEYS } from "@/services/storage";

const loginAs = async (userId: string) => AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(userId));

async function open(url: string) {
  const pending = renderRouter("./app", { initialUrl: url });
  await pending;
  return { getPathname: () => (pending as unknown as { getPathname: () => string }).getPathname() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("Alerta Ángel", () => {
  it("ajustes: guarda la zona aproximada, la quita y desactiva las alertas", async () => {
    await loginAs("u_valentina");
    await open("/settings/notifications");
    expect(await screen.findByText("Laureles, Medellín")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("alert-zone-remove"));
    expect(await screen.findByText(/Aún no tienes zona/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("alert-zone-set"));
    expect(await screen.findByText("Listo: te avisaremos de mascotas perdidas cerca de Laureles, Medellín.")).toBeOnTheScreen();
    await fireEvent(screen.getByTestId("pref-angel"), "valueChange", false);
  });

  it("pide el permiso de notificaciones si no está concedido", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: "undetermined" } as never);
    await loginAs("u_valentina");
    await open("/settings/notifications");
    await fireEvent.press(await screen.findByTestId("push-permission"));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it("cuando el círculo de vida llega a la zona, la alerta sale como notificación del celular", async () => {
    await loginAs("u_valentina");
    await open("/");
    await screen.findByTestId("home-screen");
    await waitFor(() =>
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: "🚨 Alerta Ángel: la búsqueda llegó a tu zona",
            data: { url: "/alerta/angel/negrita" },
          }),
        }),
      ),
    );
  });

  it("tocar la notificación abre la alerta", async () => {
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce({
      notification: { request: { content: { data: { url: "/alerta/angel/max" } } } },
    } as never);
    const app = await open("/");
    await waitFor(() => expect(app.getPathname()).toBe("/alerta/angel/max"));
  });
});

describe("Mis mascotas", () => {
  it("crea un perfil y 'Se perdió' abre el reporte ya lleno", async () => {
    await loginAs("u_valentina");
    const app = await open("/my-pets");
    expect(await screen.findByTestId("owned-own_rocky")).toBeOnTheScreen();
    expect(screen.getByText("Tiene un reporte activo")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Agregar mascota"));
    await fireEvent.press(await screen.findByTestId("owned-save"));
    expect(await screen.findByText("Este campo es obligatorio")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("owned-name"), "Nala");
    await fireEvent.press(screen.getByText("Gato"));
    await fireEvent.press(screen.getByTestId("owned-save"));
    await waitFor(() => expect(app.getPathname()).toBe("/my-pets"));
    const nala = await screen.findByText("Nala");
    expect(nala).toBeOnTheScreen();
    const lostButtons = screen.getAllByText("Se perdió");
    await fireEvent.press(lostButtons[lostButtons.length - 1]!);
    expect(await screen.findByText("Usamos el perfil de Nala. Solo confirma dónde y cuándo se perdió.")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Nala")).toBeOnTheScreen();
  });

  it("la tarjeta de emergencia de Inicio ofrece elegir cuál se perdió", async () => {
    await loginAs("u_valentina");
    const app = await open("/");
    await fireEvent.press(await screen.findByTestId("home-emergency"));
    expect(await screen.findByText("¿Cuál de tus mascotas se perdió?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Otra mascota (llenar desde cero)"));
    await waitFor(() => expect(app.getPathname()).toBe("/report"));
  });

  it("edita y elimina un perfil", async () => {
    await loginAs("u_valentina");
    const app = await open("/my-pets/edit?id=own_rocky");
    expect(await screen.findByDisplayValue("Rocky")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Eliminar perfil"));
    const confirm = await screen.findAllByText("Eliminar perfil");
    await fireEvent.press(confirm[confirm.length - 1]!);
    await waitFor(() => expect(app.getPathname()).toBe("/my-pets"));
    // Rocky ya no está; queda Coco.
    expect(await screen.findByTestId("owned-own_coco")).toBeOnTheScreen();
    expect(screen.queryByTestId("owned-own_rocky")).toBeNull();
  });
});

describe("afiche con QR", () => {
  it("genera el afiche sin datos de contacto y lo comparte como imagen", async () => {
    await loginAs("u_valentina");
    await open("/pet/max/poster");
    expect(await screen.findByText("SE BUSCA")).toBeOnTheScreen();
    expect(screen.getByLabelText("Código QR que abre el caso en PawFound")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("poster-share"));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///poster.png", expect.any(Object)));
    expect(await screen.findByText(/Pégalo en tiendas/)).toBeOnTheScreen();
  });

  it("si no se puede compartir, lo explica", async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    await open("/pet/luna/poster");
    expect(await screen.findByText("BUSCO A MI FAMILIA")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("poster-share"));
    expect(await screen.findByText("No pudimos crear la imagen. Intenta de nuevo.")).toBeOnTheScreen();
  });
});

describe("Ángel de patas e insignias", () => {
  it("al cerrar el caso la familia agradece a quien ayudó", async () => {
    await loginAs("u_valentina");
    await open("/pet/rocky");
    await fireEvent.press(await screen.findByTestId("reunite"));
    expect(await screen.findByText("¿Alguien te ayudó a encontrar a Rocky?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("thank-u_daniel"));
    await fireEvent.press(screen.getByText("Agradecer y cerrar el caso"));
    expect(await screen.findByText("¡Rocky ya está en casa! Le avisamos a 1 persona que fue clave.")).toBeOnTheScreen();
  });

  it("celebra una insignia nueva una sola vez", async () => {
    await loginAs("u_valentina");
    await AsyncStorage.setItem(`${STORAGE_KEYS.badgesSeen}.u_valentina`, JSON.stringify({ verified: 1 }));
    await open("/profile");
    expect(await screen.findByTestId("badge-celebration")).toBeOnTheScreen();
    for (let i = 0; i < 6 && screen.queryByTestId("badge-celebration-ok"); i++) {
      await fireEvent.press(screen.getByTestId("badge-celebration-ok"));
    }
    await waitFor(() => expect(screen.queryByTestId("badge-celebration")).not.toBeOnTheScreen());
  });
});

describe("perfil público y me gusta", () => {
  it("muestra días en PawFound, insignias y mascotas; da y quita me gusta", async () => {
    await loginAs("u_valentina");
    await open("/pet/max");
    await fireEvent.press(await screen.findByTestId("owner-profile"));
    expect(await screen.findByTestId("public-profile")).toBeOnTheScreen();
    expect(screen.getByText("María G.")).toBeOnTheScreen();
    expect(screen.getByTestId("public-member-days")).toBeOnTheScreen();
    expect(screen.getByText("2 me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("like-profile"));
    expect(await screen.findByText("1 me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("like-profile"));
    expect(await screen.findByText("2 me gusta")).toBeOnTheScreen();
  });

  it("sin cuenta, dar me gusta pide iniciar sesión; el propio perfil se ve como lo ven otros", async () => {
    const app = await open("/user/u_daniel");
    expect(await screen.findByText("3 me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("like-profile"));
    await waitFor(() => expect(app.getPathname()).toBe("/auth/login"));
  });

  it("vista previa del propio perfil con sus mascotas", async () => {
    await loginAs("u_valentina");
    await open("/profile");
    expect(await screen.findByLabelText("7 Me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("public-preview"));
    expect(await screen.findByText("Así ven tu perfil las demás personas.")).toBeOnTheScreen();
    expect(screen.getByTestId("public-pets")).toBeOnTheScreen();
  });

  it("un perfil inexistente muestra un estado claro", async () => {
    await open("/user/u_nadie");
    expect(await screen.findByText("Este perfil no existe o la cuenta se eliminó.")).toBeOnTheScreen();
  });
});

describe("convivencia: reportar en vez de bloquear", () => {
  it("reporta a una persona desde el chat con un motivo", async () => {
    await loginAs("u_valentina");
    await open("/chat/dm_maria");
    await fireEvent.press(await screen.findByLabelText("Más opciones"));
    await fireEvent.press(await screen.findByTestId("report-user"));
    expect(await screen.findByText("Reportar a María G.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "Spam o publicidad" }));
    await fireEvent.press(screen.getByTestId("report-user-send"));
    expect(await screen.findByText(/Gracias por reportar/)).toBeOnTheScreen();
    expect(screen.queryByText(/Bloquear/)).not.toBeOnTheScreen();
  });

  it("en un grupo, tocar el nombre de quien escribe abre su perfil", async () => {
    await loginAs("u_valentina");
    const app = await open("/chat/grp_max");
    const authors = await screen.findAllByLabelText("Ver perfil de Carlos R.");
    await fireEvent.press(authors[0]!);
    await waitFor(() => expect(app.getPathname()).toBe("/user/u_carlos"));
    expect(await screen.findByText("Carlos R.")).toBeOnTheScreen();
  });

  it("en un chat directo, el avatar abre el perfil de la otra persona", async () => {
    await loginAs("u_valentina");
    const app = await open("/chat/dm_maria");
    await fireEvent.press(await screen.findByTestId("dm-avatar"));
    await waitFor(() => expect(app.getPathname()).toBe("/user/u_maria"));
  });

  it("mantener presionado un mensaje permite reportarlo", async () => {
    await loginAs("u_valentina");
    await open("/chat/grp_max");
    const messages = await screen.findAllByLabelText(/Carlos R\.:/);
    await fireEvent(messages[0]!, "longPress");
    expect(await screen.findByText("Reportar a Carlos R.")).toBeOnTheScreen();
  });

  it("antes de enviar algo que podría sonar ofensivo, pregunta con amabilidad", async () => {
    await loginAs("u_valentina");
    await open("/chat/dm_maria");
    await fireEvent.changeText(await screen.findByTestId("chat-input"), "qué idiota");
    await fireEvent.press(screen.getByLabelText("Enviar mensaje"));
    expect(await screen.findByText("¿Lo enviamos así?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Editar mensaje"));
    expect(screen.getByDisplayValue("qué idiota")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Enviar mensaje"));
    await fireEvent.press(await screen.findByTestId("kind-send"));
    await act(async () => {});
    expect(await screen.findAllByText("qué idiota")).not.toHaveLength(0);
  });

  it("privacidad explica que no hay bloqueos", async () => {
    await loginAs("u_valentina");
    await open("/settings/privacy");
    expect(await screen.findByText("Aquí no se bloquea: se reporta")).toBeOnTheScreen();
  });
});
