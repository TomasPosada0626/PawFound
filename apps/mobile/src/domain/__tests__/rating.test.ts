import { badgeProgress, BADGE_ORDER, type BadgeFacts } from "../badges";
import { formatRating, isAnimalProtector, ratingAverage } from "../rating";

describe("calificación", () => {
  it("empieza en 5 y una mala nota no hunde a quien recién empieza", () => {
    expect(ratingAverage([])).toBe(5);
    expect(ratingAverage([1])).toBe(4.8);
  });

  it("solo cuentan las últimas 20", () => {
    const stars = [...Array<number>(20).fill(4), ...Array<number>(5).fill(1)];
    expect(ratingAverage(stars)).toBe(4);
  });

  it("Protector animal mira solo las calificaciones reales, sin las 5 estrellas iniciales", () => {
    expect(isAnimalProtector([])).toBe(false);
    expect(isAnimalProtector([5])).toBe(true);
    expect(isAnimalProtector([5, 5, 5, 5, 4])).toBe(true);
    expect(isAnimalProtector([1])).toBe(false);
    expect(isAnimalProtector([5, 5, 5, 5, 3])).toBe(false);
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
