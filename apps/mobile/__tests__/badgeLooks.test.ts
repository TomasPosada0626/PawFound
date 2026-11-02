import { tierLook } from "@/components/badges";

describe("apariencia de los niveles", () => {
  it("cada nivel se ve distinto y mejor que el anterior", () => {
    const looks = ([1, 2, 3] as const).map((tier) => tierLook("reporter", tier));
    expect(new Set(looks.map((l) => l?.ring.join())).size).toBe(3);
    for (let i = 1; i < looks.length; i++) {
      expect(looks[i]?.ringWidth).toBeGreaterThan(looks[i - 1]?.ringWidth ?? 0);
      expect(looks[i]?.shine).toBeGreaterThan(looks[i - 1]?.shine ?? 0);
    }
    expect(looks[2]?.top).toBe("star");
  });

  it("la leyenda es la más vistosa: corona, resplandor y destellos", () => {
    for (const legend of [tierLook("popular", 5), tierLook("protector", 1)]) {
      expect(legend).toMatchObject({ top: "crown", sparkles: true });
      expect(legend?.ring).toHaveLength(3);
      expect(legend?.ringWidth).toBeGreaterThan(tierLook("popular", 4)?.ringWidth ?? 0);
    }
  });

  it("sin obtener o con un solo nivel no tiene adornos", () => {
    expect(tierLook("reporter", 0)).toBeNull();
    expect(tierLook("verified", 1)).toBeNull();
    expect(tierLook("protector", 0)).toBeNull();
  });
});
