import { tierLook } from "@/components/badges";

describe("apariencia de los niveles", () => {
  it("cada nivel se ve distinto y suma algo al anterior: estrellas, cintas y laureles", () => {
    const [bronze, silver, gold] = ([1, 2, 3] as const).map((tier) => tierLook("reporter", tier));
    expect(new Set([bronze, silver, gold].map((l) => l?.frame.join())).size).toBe(3);
    expect([bronze?.stars, silver?.stars, gold?.stars]).toEqual([1, 2, 3]);
    expect(bronze?.ribbon).toBe(false);
    expect(silver?.ribbon).toBe(true);
    expect(silver?.laurel).toBeUndefined();
    expect(gold?.laurel).toBeTruthy();
  });

  it("Popular tiene platino antes de la leyenda, con gema", () => {
    expect(tierLook("popular", 4)).toMatchObject({ gem: true, ribbon: true, stars: 3 });
    expect(tierLook("popular", 3)?.gem).toBeUndefined();
  });

  it("la leyenda es la más vistosa: rayos, corona, laureles y destellos", () => {
    for (const legend of [tierLook("popular", 5), tierLook("protector", 1)]) {
      expect(legend).toMatchObject({ crown: true, rays: true, sparkles: true, ribbon: true });
      expect(legend?.laurel).toBeTruthy();
      expect(legend?.frame).toHaveLength(3);
    }
  });

  it("sin obtener o con un solo nivel no tiene adornos de nivel", () => {
    expect(tierLook("reporter", 0)).toBeNull();
    expect(tierLook("verified", 1)).toBeNull();
    expect(tierLook("protector", 0)).toBeNull();
  });
});
