import { badgeProgress, BADGE_ORDER, type BadgeFacts } from "../badges";
import { formatRating, isAnimalProtector, ratingAverage } from "../rating";

describe("calificación", () => {
  it("no hay promedio hasta la décima calificación real, y luego es el real", () => {
    expect(ratingAverage([])).toBe(0);
    expect(ratingAverage([5, 5, 5, 5, 5, 5, 5, 5, 1])).toBe(0);
    expect(ratingAverage([5, 5, 5, 5, 5, 5, 5, 5, 1, 1])).toBe(4.2);
  });

  it("solo cuentan las últimas 20", () => {
    const stars = [...Array<number>(20).fill(4), ...Array<number>(5).fill(1)];
    expect(ratingAverage(stars)).toBe(4);
  });

  it("Protector animal llega con la décima calificación real si el promedio pasa de 4,5", () => {
    const five = (n: number) => Array<number>(n).fill(5);
    expect(isAnimalProtector([])).toBe(false);
    expect(isAnimalProtector(five(9))).toBe(false);
    expect(isAnimalProtector(five(10))).toBe(true);
    expect(isAnimalProtector([...five(9), 1])).toBe(true);
    // 4,5 exacto no alcanza: debe ser más.
    expect(isAnimalProtector([...five(5), ...Array<number>(5).fill(4)])).toBe(false);
  });

  it("muestra los decimales que hacen falta para que coincida con la regla", () => {
    expect(formatRating(5, "es-CO")).toBe("5,0");
    expect(formatRating(4.75, "es-CO")).toBe("4,75");
    expect(formatRating(4.8, "en-US")).toBe("4.8");
  });
});

describe("insignia Popular", () => {
  const facts = (popular: number) => ({ ...Object.fromEntries(BADGE_ORDER.map((id) => [id, 0])), popular }) as BadgeFacts;

  it.each([
    [49, 0, 50],
    [50, 1, 100],
    [100, 2, 250],
    [250, 3, 500],
    [500, 4, 1000],
    [1000, 5, null],
  ])("%i me gusta es nivel %i", (likes, tier, next) => {
    expect(badgeProgress(facts(likes)).find((b) => b.id === "popular")).toMatchObject({ tier, next, maxTier: 5 });
  });
});
