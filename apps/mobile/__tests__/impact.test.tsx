import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderRouter, screen } from "expo-router/testing-library";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("Nuestro impacto", () => {
  it("muestra las cifras de la ciudad donde está la persona", async () => {
    await renderRouter("./app", { initialUrl: "/" });
    expect(await screen.findByText("Nuestro impacto en Medellín")).toBeOnTheScreen();
    expect(screen.getByText("Mascotas reunidas")).toBeOnTheScreen();
  });
});
