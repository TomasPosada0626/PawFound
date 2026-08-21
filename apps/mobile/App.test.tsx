import { render } from "@testing-library/react-native";

import App from "./App";

describe("App", () => {
  it("renders the PawFound wordmark and tagline", async () => {
    // RNTL 14+ renders asynchronously by default — see the v14 migration guide.
    const { getByText } = await render(<App />);

    expect(getByText("Found")).toBeTruthy();
    expect(getByText("Conectamos patas, reunimos familias")).toBeTruthy();
  });
});
