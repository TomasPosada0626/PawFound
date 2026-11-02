import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("tema", () => {
  it("un solo botón alterna entre claro y oscuro", async () => {
    await renderRouter("./app", { initialUrl: "/auth/login" });
    expect(await screen.findAllByTestId("theme-toggle")).toHaveLength(1);
    expect(screen.getByLabelText("Activar modo oscuro")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("theme-toggle"));
    expect(await screen.findByLabelText("Activar modo claro")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("theme-toggle"));
    expect(await screen.findByLabelText("Activar modo oscuro")).toBeOnTheScreen();
  });
});
