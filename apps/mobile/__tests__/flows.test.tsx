/**
 * Pruebas de flujo completo sobre el router real (expo-router/testing-library), con el
 * backend de demostración. Cubren los recorridos críticos de docs/flujos/.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { MockBackend } from "@/services/mockBackend";
import { STORAGE_KEYS } from "@/services/storage";

const loginAs = async (userId: string) => AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(userId));

/** renderRouter devuelve una promesa con helpers; se envuelve para no perderlos al hacer await. */
async function open(url: string) {
  const pending = renderRouter("./app", { initialUrl: url });
  await pending;
  return { getPathname: () => (pending as unknown as { getPathname: () => string }).getPathname() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("explorar sin cuenta y reportar una mascota perdida", () => {
  it("pide cuenta al reportar, vuelve al formulario y publica con grupo de caso", async () => {
    const app = await open("/");
    expect(await screen.findByText("¡Hola!")).toBeOnTheScreen();
    expect(screen.getAllByText("Max").length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId("tab-report"));
    expect(await screen.findByText("Necesitas una cuenta para continuar")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId("login-email"), "demo@pawfound.app");
    await fireEvent.changeText(screen.getByTestId("login-password"), "PawFound2026");
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("report-screen")).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/report");

    // Publicar vacío marca los errores sin enviar.
    await fireEvent.press(screen.getByTestId("publish"));
    expect(await screen.findByText("Agrega al menos una foto: es lo que más ayuda a reconocerla.")).toBeOnTheScreen();
    expect(screen.getByText("Marca en el mapa dónde fue vista.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId("report-name"), "Kira");
    await fireEvent.press(screen.getByTestId("report-species"));
    await fireEvent.press(await screen.findByRole("radio", { name: "Perro" }));
    await fireEvent.press(screen.getByTestId("add-photo"));
    await fireEvent.press(await screen.findByTestId("photo-library"));
    await fireEvent.press(screen.getByTestId("toggle-traumatic"));
    await fireEvent.press(screen.getByTestId("use-my-location"));
    await waitFor(() => expect(screen.getByDisplayValue("Laureles, Medellín")).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId("publish"));
    expect(await screen.findByText("¡Reporte publicado!")).toBeOnTheScreen();
    expect(screen.getByText("Creamos el grupo “Encontremos a Kira” y avisamos a la comunidad cercana.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Ir al grupo"));
    expect(await screen.findByText("Encontremos a Kira")).toBeOnTheScreen();
    expect(screen.getByText("Se creó el grupo del caso")).toBeOnTheScreen();
  });

  it("un invitado que quiere unirse a un grupo va primero al login", async () => {
    const app = await open("/pet/max");
    await fireEvent.press(await screen.findByTestId("join-group"));
    await waitFor(() => expect(app.getPathname()).toBe("/auth/login"));
  });
});

describe("registro y verificación por correo", () => {
  it("anuncia el código incorrecto y otorga la insignia al verificar", async () => {
    await open("/auth/register");
    await fireEvent.changeText(await screen.findByTestId("register-name"), "Ana Gómez");
    await fireEvent.changeText(screen.getByTestId("register-email"), "ana@correo.co");
    await fireEvent.changeText(screen.getByTestId("register-username"), "ana_g");
    await fireEvent.changeText(screen.getByTestId("register-password"), "Clave2026");
    await fireEvent.changeText(screen.getByTestId("register-confirm"), "Clave2026");
    expect(screen.getByTestId("register-submit")).toBeDisabled();
    await fireEvent.press(screen.getByTestId("accept-terms"));
    await fireEvent.press(screen.getByTestId("confirm-age"));
    await fireEvent.press(screen.getByTestId("register-submit"));

    expect(await screen.findByText(/Te enviamos un código de 6 dígitos a an•+@correo\.co/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("otp-0"), "000000");
    await fireEvent.press(screen.getByTestId("verify-submit"));
    expect(await screen.findByText("Código incorrecto. Te quedan 4 intentos.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId("otp-0"), "123456");
    await fireEvent.press(screen.getByTestId("verify-submit"));
    expect(await screen.findByText("¡Correo verificado! Ganaste tu primera insignia.")).toBeOnTheScreen();

    // Paso siguiente: activar las alertas, con su porqué y sin obligar.
    expect(await screen.findByTestId("alerts-onboarding")).toBeOnTheScreen();
    // Antes de pedir el permiso explica para qué es la ubicación (lo exige Google Play).
    expect(screen.getByTestId("alerts-privacy")).toHaveTextContent(/también con la app cerrada/);
    expect(await screen.findByText("No recibirás alertas de mascotas perdidas")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Ahora no"));
    await waitFor(() => expect(screen.queryByTestId("alerts-onboarding")).toBeNull());
  });

  it("muestra un error genérico con credenciales inválidas", async () => {
    await open("/auth/login");
    await fireEvent.changeText(await screen.findByTestId("login-email"), "nadie@correo.co");
    await fireEvent.changeText(screen.getByTestId("login-password"), "x");
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Correo o contraseña incorrectos")).toBeOnTheScreen();
  });
});

describe("círculo de vida", () => {
  it("previsualiza cuánto crecerá el círculo en el tiempo", async () => {
    await open("/pet/max");
    expect(await screen.findByText("Así crece su círculo de vida")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("preview-30"));
    expect(await screen.findByText(/Dentro de 30 min:/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("preview-0"));
    await waitFor(() => expect(screen.queryByText(/Dentro de 30 min:/)).not.toBeOnTheScreen());
  });
});

describe("chats con traducción automática", () => {
  it("muestra los mensajes en el idioma del lector con opción de ver el original", async () => {
    await loginAs("u_valentina");
    await open("/chat/grp_max");
    expect(
      await screen.findByText("Vivo cerca de la 70. ¡Voy a revisar el parque con unos premios y les cuento!"),
    ).toBeOnTheScreen();
    const toggle = screen.getAllByText("Traducido del inglés · Ver original")[0]!;
    await fireEvent.press(toggle);
    expect(
      await screen.findByText("I live near La 70. I'll check the park with some treats and let you know!"),
    ).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId("chat-input"), "Voy en camino");
    await fireEvent.press(screen.getByTestId("chat-send"));
    expect(await screen.findByText("Voy en camino")).toBeOnTheScreen();
  });
});

describe("mensajes, mapa, ajustes e idioma", () => {
  it("lista grupos y marca notificaciones como leídas", async () => {
    await loginAs("u_valentina");
    await open("/messages?tab=notifications");
    expect(await screen.findByText("🚨 Alerta Ángel")).toBeOnTheScreen();
    expect(screen.getAllByText("Mascota perdida reportada")).toHaveLength(1);
    await fireEvent.press(screen.getByTestId("mark-all-read"));
    await waitFor(() => expect(screen.queryByTestId("mark-all-read")).not.toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("tab", { name: "Grupos" }));
    expect(await screen.findByText("Encontremos a Max")).toBeOnTheScreen();
  });

  it("filtra el mapa y muestra el estado vacío", async () => {
    await open("/map");
    expect(await screen.findByText("10 resultados")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("filter-found"));
    expect(await screen.findByText("4 resultados")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("map-search"), "zzz");
    expect(await screen.findByTestId("map-empty")).toBeOnTheScreen();
  });

  it("cambia la app a inglés desde el menú", async () => {
    await open("/");
    await fireEvent.press(await screen.findByTestId("open-menu"));
    await fireEvent.press(await screen.findByTestId("locale-en"));
    expect(await screen.findByText("Hi there!")).toBeOnTheScreen();
  });

  it("valida el nombre de usuario al editar el perfil", async () => {
    await loginAs("u_valentina");
    await open("/settings/edit-profile");
    await fireEvent.changeText(await screen.findByTestId("edit-username"), "a");
    await fireEvent.press(screen.getByTestId("save-profile"));
    expect(await screen.findByText("Usa de 3 a 20 letras, números o _")).toBeOnTheScreen();
  });

  it("elimina la cuenta desde Privacidad solo tras escribir la palabra y vuelve a modo exploración", async () => {
    await loginAs("u_valentina");
    const app = await open("/settings/privacy");
    await fireEvent.press(await screen.findByTestId("delete-account"));
    expect(await screen.findByText(/Tus publicaciones y solicitudes de PawFamily/)).toBeOnTheScreen();
    // Sin la palabra no se puede: un toque sin querer no borra nada.
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    expect(app.getPathname()).toBe("/settings/privacy");
    await fireEvent.changeText(screen.getByTestId("delete-account-word"), "eliminar");
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => expect(app.getPathname()).toBe("/"));
    expect(await screen.findByText("¡Hola!")).toBeOnTheScreen();
  });

  it("si no se puede eliminar la cuenta, lo dice y la cuenta sigue", async () => {
    const failing = jest.spyOn(MockBackend.prototype, "deleteAccount").mockRejectedValueOnce(new Error("network"));
    await loginAs("u_valentina");
    const app = await open("/profile");
    await fireEvent.press(await screen.findByTestId("profile-delete-account"));
    await fireEvent.changeText(await screen.findByLabelText("Para confirmar, escribe ELIMINAR"), "ELIMINAR");
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    expect(await screen.findByText("No pudimos eliminar tu cuenta. Revisa tu conexión e intenta de nuevo.")).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/profile");
    expect(await AsyncStorage.getItem(STORAGE_KEYS.session)).toBe(JSON.stringify("u_valentina"));
    failing.mockRestore();
  });

  it("Perfil tiene «Eliminar mi cuenta»; cancelar no borra nada", async () => {
    await loginAs("u_valentina");
    await open("/profile");
    await fireEvent.press(await screen.findByTestId("profile-delete-account"));
    await fireEvent.changeText(await screen.findByLabelText("Para confirmar, escribe ELIMINAR"), "ELIMINA");
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    await fireEvent.press(screen.getByText("Cancelar"));
    await waitFor(() => expect(screen.queryByTestId("delete-account-sheet")).not.toBeOnTheScreen());
    expect(screen.getByTestId("profile-delete-account")).toBeOnTheScreen();
  });

  it("los enlaces de Alerta Ángel abren la alerta, con aviso comunitario y acceso al caso", async () => {
    const app = await open("/alerta/angel/max");
    expect(await screen.findByText("Una mascota se perdió cerca de ti")).toBeOnTheScreen();
    expect(screen.getByText(/No es un servicio de emergencia ni del gobierno/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Ver el caso completo"));
    await waitFor(() => expect(app.getPathname()).toBe("/pet/max"));
  });

  it("una alerta inexistente muestra un estado claro", async () => {
    await open("/alerta/angel/no-existe");
    expect(await screen.findByText("Esta alerta ya no está disponible.")).toBeOnTheScreen();
  });
});
