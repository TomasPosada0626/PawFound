/**
 * Red entre personas: buscar por nombre de usuario, seguirse con solicitud y aceptación, eliminar
 * seguidores, mascotas solo para quienes se siguen y estrellas al cerrar un caso.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
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

describe("buscar personas", () => {
  it("encuentra por nombre de usuario con o sin @ y abre el perfil", async () => {
    await loginAs("u_valentina");
    const app = await open("/buscar-personas");
    const input = await screen.findByTestId("search-people-input");
    expect(screen.getByText("Escribe al menos 3 letras. No hace falta el @.")).toBeOnTheScreen();

    // Con dos letras todavía no busca: se deja pasar la pausa de escritura.
    await fireEvent.changeText(input, "ma");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByTestId("person-u_maria")).not.toBeOnTheScreen();

    await fireEvent.changeText(input, "@mar");
    expect(await screen.findByTestId("person-u_maria")).toBeOnTheScreen();

    await fireEvent.changeText(input, "nadie_con_ese_nombre");
    expect(await screen.findByText("No encontramos a nadie con ese nombre de usuario.")).toBeOnTheScreen();

    await fireEvent.changeText(input, "mar");
    await fireEvent.press(await screen.findByLabelText(/^María G\./));
    await waitFor(() => expect(app.getPathname()).toBe("/user/u_maria"));
  });
});

describe("seguirse", () => {
  it("envía la solicitud, la cancela y explica para qué sirve", async () => {
    await loginAs("u_valentina");
    await open("/user/u_daniel");
    expect(await screen.findByText(/Si acepta, se seguirán mutuamente/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("follow-user"));
    expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("follow-user"));
    expect(await screen.findByText("Seguir")).toBeOnTheScreen();
  });

  it("se puede dar me gusta sin seguir a la persona", async () => {
    await loginAs("u_valentina");
    await open("/user/u_daniel");
    expect(await screen.findByText("3 me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("like-profile"));
    expect(await screen.findByText("4 me gusta")).toBeOnTheScreen();
  });

  it("dejar de seguir pide confirmación y el me gusta se mantiene", async () => {
    await loginAs("u_valentina");
    await open("/user/u_maria");
    expect(await screen.findByText("2 me gusta")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("follow-user"));
    expect(await screen.findByText("¿Dejar de seguir a María G.?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("confirm-accept"));
    expect(await screen.findByText("Seguir")).toBeOnTheScreen();
    expect(screen.getByText("2 me gusta")).toBeOnTheScreen();
  });

  it("sin cuenta pide iniciar sesión", async () => {
    const app = await open("/user/u_daniel");
    await fireEvent.press(await screen.findByTestId("follow-user"));
    await waitFor(() => expect(app.getPathname()).toBe("/auth/login"));
  });

  it("el perfil de otra persona muestra los números pero no abre las listas", async () => {
    await loginAs("u_daniel");
    const app = await open("/user/u_valentina");
    expect(await screen.findByLabelText("1 Seguidores")).toBeOnTheScreen();
    expect(screen.getByLabelText("1 Siguiendo")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("public-followers"));
    expect(app.getPathname()).toBe("/user/u_valentina");
    expect(screen.queryByTestId("followers-screen")).not.toBeOnTheScreen();
  });

  it("las mascotas de un perfil solo las ven quienes se siguen", async () => {
    await loginAs("u_daniel");
    await open("/user/u_valentina");
    expect(await screen.findByText("Solo quienes siguen a esta persona pueden ver sus mascotas.")).toBeOnTheScreen();
    expect(screen.queryByTestId("public-pets")).not.toBeOnTheScreen();
  });

  it("quien sigue a la persona ve sus mascotas, aunque ella no siga de vuelta", async () => {
    await loginAs("u_maria");
    await open("/user/u_valentina");
    expect(await screen.findByTestId("public-pets")).toBeOnTheScreen();
  });

  it("muestra la calificación: toda cuenta empieza en 5 estrellas, sin texto extra", async () => {
    await open("/user/u_daniel");
    const rating = await screen.findByTestId("public-rating");
    expect(rating).toHaveTextContent(/5,0/);
    expect(rating).not.toHaveTextContent(/calificaci/i);
  });
});

describe("mis seguidores", () => {
  it("muestra los dos números en mi perfil y abre cada lista", async () => {
    await loginAs("u_valentina");
    await open("/profile");
    expect(await screen.findByLabelText("1 Seguidores")).toBeOnTheScreen();
    expect(screen.getByLabelText("1 Siguiendo")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("open-following"));
    expect(await screen.findByTestId("unfollow-u_maria")).toBeOnTheScreen();
  });

  it("acepta una solicitud, elimina un seguidor y deja de seguir", async () => {
    await loginAs("u_valentina");
    await open("/profile");
    expect(await screen.findByText("1 solicitud nueva")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("1 solicitud nueva"));

    // Con solicitudes pendientes es lo primero que se ve.
    expect(await screen.findByTestId("person-u_carlos")).toBeOnTheScreen();
    expect(screen.getByText("Solicitudes (1)")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("accept-u_carlos"));
    expect(await screen.findByText("Ahora tú y Carlos R. se siguen.")).toBeOnTheScreen();
    expect(await screen.findByText("Seguidores (2)")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("tab-followers"));
    await fireEvent.press(await screen.findByTestId("remove-u_maria"));
    expect(await screen.findByText("¿Eliminar a María G.?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("confirm-accept"));
    expect(await screen.findByText("Seguidores (1)")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("tab-following"));
    // La solicitud enviada aparece aquí y se puede cancelar.
    await fireEvent.press(await screen.findByTestId("cancel-u_laura"));
    await waitFor(() => expect(screen.queryByTestId("cancel-u_laura")).not.toBeOnTheScreen());
    // Eliminar a María como seguidora no cambia que yo la siga.
    await fireEvent.press(await screen.findByTestId("unfollow-u_maria"));
    await fireEvent.press(await screen.findByTestId("confirm-accept"));
    await fireEvent.press(await screen.findByTestId("unfollow-u_carlos"));
    await fireEvent.press(await screen.findByTestId("confirm-accept"));
    expect(await screen.findByText("Aún no sigues a nadie.")).toBeOnTheScreen();
  });

  it("rechaza una solicitud sin avisarle a la otra persona", async () => {
    await loginAs("u_valentina");
    await open("/seguidores");
    await fireEvent.press(await screen.findByTestId("decline-u_carlos"));
    expect(await screen.findByText("Solicitudes (0)")).toBeOnTheScreen();
    expect(
      screen.getByText("Solo tú ves estas listas. Las demás personas ven únicamente los números en tu perfil."),
    ).toBeOnTheScreen();
  });

  it("sin cuenta pide iniciar sesión", async () => {
    const app = await open("/seguidores");
    await waitFor(() => expect(app.getPathname()).toBe("/auth/login"));
  });
});

describe("solicitudes y mascotas de amigos", () => {
  it("la pestaña Perfil muestra el punto rojo cuando hay solicitudes", async () => {
    await loginAs("u_valentina");
    await open("/");
    expect(await screen.findByLabelText("Perfil, 1 solicitud nueva")).toBeOnTheScreen();
  });

  it("sin solicitudes la pestaña Perfil no tiene punto", async () => {
    await loginAs("u_daniel");
    await open("/");
    expect(await screen.findByLabelText("Perfil")).toBeOnTheScreen();
  });

  it("al tocar una mascota de quien sigo se abre su ficha, sin las señas particulares", async () => {
    await loginAs("u_maria");
    const app = await open("/user/u_valentina");
    const [first] = await screen.findAllByTestId(/^friend-pet-/);
    await fireEvent.press(first!);
    expect(await screen.findByTestId("friend-pet")).toBeOnTheScreen();
    expect(app.getPathname()).toMatch(/^\/user\/mascota\//);
    expect(
      screen.getByText("Ves esta ficha porque sigues a su familia. Las señas particulares solo aparecen si publican un reporte."),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Señas particulares")).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("friend-pet-owner"));
    await waitFor(() => expect(app.getPathname()).toBe("/user/u_valentina"));
  });

  it("una mascota que ya no se puede ver muestra un aviso", async () => {
    await loginAs("u_maria");
    await open("/user/mascota/no-existe");
    expect(await screen.findByText("No pudimos mostrar esta mascota. Puede que ya no sigas a su familia.")).toBeOnTheScreen();
  });
});

describe("calificar al cerrar el caso", () => {
  it("al elegir a quien ayudó aparecen las estrellas y se guarda la calificación", async () => {
    await loginAs("u_valentina");
    await open("/pet/rocky");
    await fireEvent.press(await screen.findByTestId("reunite"));
    expect(screen.queryByTestId("stars-u_daniel-1")).not.toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId("thank-u_daniel"));
    // Empieza en 5 y se puede cambiar.
    expect(screen.getByLabelText("5 estrellas").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId("stars-u_daniel-3"));
    expect(screen.getByLabelText("3 estrellas").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByText("Agradecer y cerrar el caso"));
    expect(await screen.findByText("¡Rocky ya está en casa! Le avisamos a 1 persona que fue clave.")).toBeOnTheScreen();
  });
});
