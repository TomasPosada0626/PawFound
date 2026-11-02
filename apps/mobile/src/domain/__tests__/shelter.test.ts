import { nitCheckDigit, normalizeNit } from "../shelter";

describe("NIT", () => {
  it("calcula el dígito de verificación de la DIAN", () => {
    expect(nitCheckDigit("900123456")).toBe(8);
    expect(nitCheckDigit("860034313")).toBe(7);
  });

  it("acepta los formatos comunes y rechaza un dígito equivocado", () => {
    expect(normalizeNit("900.123.456-8")).toBe("900123456-8");
    expect(normalizeNit("9001234568")).toBe("900123456-8");
    expect(normalizeNit(" 900123456-8 ")).toBe("900123456-8");
    expect(normalizeNit("900123456-1")).toBeNull();
    expect(normalizeNit("abc")).toBeNull();
    expect(normalizeNit("12")).toBeNull();
  });
});
