/**
 * PawFamily: políticas al entrar, lista con filtros, publicar, postularse, responder solicitudes
 * con chat y reportar a quien pide dinero.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";

import { STORAGE_KEYS } from "@/services/storage";

const loginAs = async (userId: string) => AsyncStorage.setItem(STORAGE_KEYS.session, JSON.stringify(userId));
const acceptedTerms = async () => AsyncStorage.setItem(STORAGE_KEYS.pawfamilyTerms, "true");

async function open(url: string) {
  const pending = renderRouter("./app", { initialUrl: url });
  await pending;
  return { getPathname: () => (pending as unknown as { getPathname: () => string }).getPathname() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("entrar a PawFamily", () => {
  it("se llega desde Inicio y primero hay que aceptar las políticas", async () => {
    const app = await open("/");
    await fireEvent.press(await screen.findByTestId("open-pawfamily"));
    expect(await screen.findByTestId("pawfamily-terms")).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/pawfamily");
    expect(screen.getByText(/100 % gratuita/)).toBeOnTheScreen();
    // Sin marcar la casilla no se puede entrar.
    await fireEvent.press(screen.getByTestId("pawfamily-terms-accept"));
    expect(screen.getByTestId("pawfamily-terms")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("pawfamily-terms-check"));
    await fireEvent.press(screen.getByTestId("pawfamily-terms-accept"));
    expect(await screen.findByTestId("adoption-ad_canela")).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.pawfamilyTerms)).toBe("true");
  });

  it("se puede volver a PawFound", async () => {
    await acceptedTerms();
    const app = await open("/pawfamily");
    await fireEvent.press(await screen.findByTestId("back-to-pawfound"));
    await waitFor(() => expect(app.getPathname()).toBe("/"));
  });
});

describe("buscar", () => {
  it("filtra por especie, sexo, tamaño, edad y toda la ciudad", async () => {
    await acceptedTerms();
    await open("/pawfamily");
    expect(await screen.findByTestId("adoption-ad_simon")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("filter-cat"));
    await waitFor(() => expect(screen.queryByTestId("adoption-ad_canela")).not.toBeOnTheScreen());
    expect(screen.getByTestId("adoption-ad_simon")).toBeOnTheScreen();
    // Tocar el filtro otra vez lo quita.
    await fireEvent.press(screen.getByTestId("filter-cat"));
    await fireEvent.press(screen.getByTestId("filter-female"));
    await waitFor(() => expect(screen.queryByTestId("adoption-ad_simon")).not.toBeOnTheScreen());
    expect(screen.getByTestId("adoption-ad_canela")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("filter-female"));
    await fireEvent.press(screen.getByTestId("filter-large"));
    expect(await screen.findByTestId("adoption-ad_bruno")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("filter-large"));
    await fireEvent.press(screen.getByTestId("filter-senior"));
    await waitFor(() => expect(screen.queryByTestId("adoption-ad_canela")).not.toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("filter-senior"));
    // "Toda Medellín" deja fuera a Bruno, que está en Envigado.
    await fireEvent.press(await screen.findByTestId("whole-city"));
    await waitFor(() => expect(screen.queryByTestId("adoption-ad_bruno")).not.toBeOnTheScreen());
    expect(screen.getByTestId("adoption-ad_canela")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("radius-2"));
    await fireEvent.press(screen.getByTestId("filter-dog"));
    await fireEvent.press(screen.getByTestId("filter-large"));
    expect(await screen.findByText("No hay mascotas en adopción con estos filtros.")).toBeOnTheScreen();
  });
});

describe("adoptar", () => {
  it("el informe corto valida y queda en revisión", async () => {
    await loginAs("u_valentina");
    await acceptedTerms();
    const app = await open("/pawfamily/ad_canela");
    expect(await screen.findByTestId("adoption-detail")).toBeOnTheScreen();
    // La dirección solo la ve quien fue aceptada.
    expect(screen.queryByTestId("adoption-address")).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("adoption-apply"));
    expect(await screen.findByTestId("adoption-apply-form")).toBeOnTheScreen();
    expect(screen.getByLabelText(/¿Por qué quieres adoptar a esta perrita\?/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("apply-send"));
    expect(await screen.findByText("Escribe un número entre 1 y 20.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("apply-household"), "3");
    await fireEvent.press(screen.getByTestId("apply-had-pets"));
    await fireEvent.changeText(screen.getByTestId("apply-pets-count"), "2");
    await fireEvent.changeText(screen.getByTestId("apply-reason"), "Corta");
    await fireEvent.press(screen.getByTestId("apply-send"));
    expect(await screen.findByText("Cuéntanos un poco más (al menos 20 caracteres).")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId("apply-reason"), "Tenemos patio, tiempo para pasearla y mucho amor.");
    await fireEvent.press(screen.getByTestId("apply-send"));
    await waitFor(() => expect(app.getPathname()).toBe("/pawfamily/ad_canela"));
    expect(await screen.findByText("Tu solicitud está en revisión. Te avisaremos cuando respondan.")).toBeOnTheScreen();
  });

  it("quien publicó acepta una solicitud y se abre el chat", async () => {
    await loginAs("u_daniel");
    await acceptedTerms();
    const app = await open("/pawfamily/ad_canela");
    expect(await screen.findByTestId("application-ap_maria_canela")).toBeOnTheScreen();
    expect(screen.getByText("Viven 3 personas en su casa")).toBeOnTheScreen();
    expect(screen.getByTestId("adoption-address")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("accept-ap_maria_canela"));
    await waitFor(() => expect(app.getPathname()).toMatch(/^\/chat\//));
    expect(await screen.findByText(/aceptó la solicitud de adopción/)).toBeOnTheScreen();
  });

  it("quien publicó puede rechazar y marcar como adoptada", async () => {
    await loginAs("u_daniel");
    await acceptedTerms();
    await open("/pawfamily/ad_canela");
    await fireEvent.press(await screen.findByTestId("decline-ap_maria_canela"));
    expect(await screen.findByText("Solicitud rechazada. Le avisamos con amabilidad.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("adoption-adopted"));
    expect(await screen.findByText("¿Canela ya tiene hogar?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("confirm-accept"));
    expect(await screen.findByText("¡Adoptada!")).toBeOnTheScreen();
  });

  it("reportar a quien pide dinero", async () => {
    await loginAs("u_valentina");
    await acceptedTerms();
    await open("/pawfamily/ad_simon");
    await fireEvent.press(await screen.findByTestId("adoption-report"));
    await fireEvent.press(await screen.findByTestId("reason-money"));
    await fireEvent.press(screen.getByTestId("adoption-report-send"));
    expect(await screen.findByText("Gracias. Moderación revisará el reporte.")).toBeOnTheScreen();
  });

  it("sin cuenta, postularse pide iniciar sesión", async () => {
    await acceptedTerms();
    const app = await open("/pawfamily/ad_simon");
    await fireEvent.press(await screen.findByTestId("adoption-apply"));
    await waitFor(() => expect(app.getPathname()).toBe("/auth/login"));
  });
});

describe("dar en adopción", () => {
  it("pide fotos y ubicación, publica y abre la ficha", async () => {
    await loginAs("u_valentina");
    await acceptedTerms();
    const app = await open("/pawfamily/publicar");
    await fireEvent.press(await screen.findByTestId("publish-send"));
    expect(await screen.findByText("Agrega al menos una foto.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("publish-add-photo"));
    await fireEvent.changeText(screen.getByTestId("publish-name"), "Nala");
    await fireEvent.press(screen.getByTestId("publish-species-cat"));
    await fireEvent.changeText(screen.getByTestId("publish-description"), "Gatica tranquila y cariñosa, ya esterilizada.");
    await fireEvent.press(screen.getByTestId("publish-send"));
    expect(await screen.findByText("Indica dónde está la mascota.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("publish-location"));
    expect(await screen.findByText("Ubicación lista")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("publish-send"));
    await waitFor(() => expect(app.getPathname()).toMatch(/^\/pawfamily\/ad_/));
    expect(await screen.findByText("Nala")).toBeOnTheScreen();
    expect(screen.getByText("Todavía no hay solicitudes.")).toBeOnTheScreen();
  });

  it("mis publicaciones muestra las solicitudes por responder", async () => {
    await loginAs("u_daniel");
    await acceptedTerms();
    await open("/pawfamily/mias");
    expect(await screen.findByText("1 solicitud por responder")).toBeOnTheScreen();
    expect(screen.getByTestId("adoption-ad_bruno")).toBeOnTheScreen();
  });

  it("sin solicitudes enviadas muestra cómo empezar", async () => {
    await loginAs("u_valentina");
    await open("/pawfamily/solicitudes");
    expect(await screen.findByText("Todavía no has enviado solicitudes.")).toBeOnTheScreen();
  });
});
