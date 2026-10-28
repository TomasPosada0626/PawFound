import { readFileSync } from "fs";
import { join } from "path";

import { WHEN_OFFSETS_MIN, emptyDraft, isDraftMeaningful, toReportInput, validateDraft } from "@/features/reportDraft";
import { localizedText, messagePreview, messageText, threadTitle } from "@/features/messages";
import { dictionaries, resolveLocale, translate, translateList, type TKey } from "@/i18n/core";
import { chatTimestamp, countdown, relativeTime } from "@/i18n/format";
import type { Message, PetCase, Thread } from "@/domain/types";
import { contrastRatio, hexToRgbChannels, palettes, primaryGradient } from "@/theme/tokens";

const NOW = new Date("2026-10-27T15:00:00");

function leafKeys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  const obj = node as Record<string, unknown>;
  if (Object.keys(obj).sort().join() === "one,other") return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  it("español e inglés tienen exactamente las mismas claves y ninguna vacía", () => {
    const es = leafKeys(dictionaries.es).sort();
    const en = leafKeys(dictionaries.en).sort();
    expect(en).toEqual(es);
    for (const key of es) {
      expect(translate("es", key as TKey).trim()).not.toBe("");
      expect(translate("en", key as TKey).trim()).not.toBe("");
    }
  });

  it("los marcadores {x} de cada texto coinciden entre idiomas", () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const key of leafKeys(dictionaries.es)) {
      expect([key, vars(translate("en", key as TKey, { count: 2 }))]).toEqual([
        key,
        vars(translate("es", key as TKey, { count: 2 })),
      ]);
    }
  });

  it("interpola, aplica plurales y conserva marcadores desconocidos", () => {
    expect(translate("es", "home.greeting", { name: "Vale" })).toBe("¡Hola, Vale!");
    expect(translate("es", "time.hours", { count: 1 })).toBe("Hace 1 hora");
    expect(translate("en", "time.hours", { count: 3 })).toBe("3 hours ago");
    expect(translate("es", "home.greeting", {})).toBe("¡Hola, {name}!");
    expect(translate("es", "no.existe" as TKey)).toBe("no.existe");
    expect(translateList("es", "tips.dog_calm")).toHaveLength(3);
  });

  it("resuelve el idioma del dispositivo con español por defecto", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("pt")).toBe("es");
    expect(resolveLocale(undefined)).toBe("es");
  });

  it("formatea tiempos relativos y cuentas regresivas", () => {
    const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
    expect(relativeTime(ago(0.2), NOW, "es")).toBe("Justo ahora");
    expect(relativeTime(ago(25), NOW, "es")).toBe("Hace 25 min");
    expect(relativeTime(ago(60), NOW, "es")).toBe("Hace 1 hora");
    expect(relativeTime(ago(60 * 30), NOW, "es")).toBe("Ayer");
    expect(relativeTime(ago(60 * 24 * 3), NOW, "en")).toBe("3 days ago");
    expect(relativeTime(ago(60 * 24 * 10), NOW, "es")).toMatch(/oct/i);
    expect(chatTimestamp(ago(60 * 24), NOW, "es")).toBe("Ayer");
    expect(chatTimestamp(ago(5), NOW, "en")).toMatch(/PM/);
    expect(countdown(45)).toBe("0:45");
    expect(countdown(-3)).toBe("0:00");
  });
});

describe("tokens de color", () => {
  it("global.css replica exactamente los tokens (claro y oscuro)", () => {
    const css = readFileSync(join(__dirname, "../../global.css"), "utf8");
    const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const [light = "", dark = ""] = css.split(".dark:root");
    for (const [name, hex] of Object.entries(palettes.light))
      expect(light).toContain(`--color-${kebab(name)}: ${hexToRgbChannels(hex)};`);
    for (const [name, hex] of Object.entries(palettes.dark))
      expect(dark).toContain(`--color-${kebab(name)}: ${hexToRgbChannels(hex)};`);
  });

  it.each(["light", "dark"] as const)("cumple contraste WCAG AA en modo %s", (scheme) => {
    const p = palettes[scheme];
    expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.body, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.primaryStrong, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.lostInk, p.lostSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.foundInk, p.foundSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.danger, p.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("texto blanco sobre botones e insignias de estado ≥ 4.5:1", () => {
    for (const c of [...primaryGradient, palettes.light.lost, palettes.light.found, palettes.light.primaryStrong]) {
      expect(contrastRatio("#FFFFFF", c)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("documenta por qué el teal de marca no se usa como texto", () => {
    expect(contrastRatio("#1FA98F", "#FFFFFF")).toBeLessThan(3);
  });
});

describe("borrador de reporte", () => {
  it("solo se restaura si tiene contenido", () => {
    expect(isDraftMeaningful(emptyDraft())).toBe(false);
    expect(isDraftMeaningful({ ...emptyDraft(), name: "Max" })).toBe(true);
  });

  it("valida y convierte a la petición del backend", () => {
    const draft = {
      ...emptyDraft("lost"),
      name: "Max",
      species: "dog" as const,
      photos: ["a"],
      point: { latitude: 6, longitude: -75 },
      when: "h3" as const,
    };
    expect(validateDraft(draft)).toEqual({});
    const input = toReportInput(draft, NOW, "Zona");
    expect(input.lastSeenAt).toBe(new Date(NOW.getTime() - WHEN_OFFSETS_MIN.h3 * 60_000).toISOString());
    expect(input).toMatchObject({ zone: "Zona", sex: "unknown", age: "unknown", size: "medium", foundSearchRadius: undefined });
    expect(toReportInput({ ...draft, kind: "found", zone: " Belén " }, NOW, "Zona")).toMatchObject({
      zone: "Belén",
      foundSearchRadius: 400,
    });
    expect(() => toReportInput(emptyDraft(), NOW, "Z")).toThrow();
  });
});

describe("mensajes", () => {
  const t = (key: TKey, params?: Record<string, string | number>) => translate("es", key, params);
  const pet = { id: "max", kind: "lost", name: "Max" } as PetCase;
  const msg = (over: Partial<Message>): Message => ({
    id: "m",
    threadId: "t",
    authorId: "u_a",
    authorShortName: "Ana R.",
    text: "Hola",
    at: NOW.toISOString(),
    kind: "text",
    ...over,
  });

  it("titula grupos con el nombre fijo del caso", () => {
    const group = { kind: "group" } as Thread;
    expect(threadTitle(group, pet, undefined, t, (n) => n)).toBe("Encontremos a Max");
    expect(threadTitle(group, { ...pet, kind: "found" }, undefined, t, (n) => n)).toBe("Encontremos a su familia");
    expect(threadTitle({ kind: "dm" } as Thread, pet, undefined, t, (n) => n)).toBe("Usuario eliminado");
  });

  it("traduce los mensajes de sistema al mostrarlos", () => {
    expect(messageText(msg({ kind: "system", text: "created" }), pet, t)).toBe("Se creó el grupo del caso");
    expect(messageText(msg({ kind: "system", text: "reunited" }), pet, t)).toContain("Max");
    expect(messageText(msg({ kind: "sighting", text: "Estadio" }), pet, t)).toBe("📍 Ana R. reportó un avistamiento en Estadio");
  });

  it("muestra la traducción al idioma del lector, o el original marcado si no existe", () => {
    const english = msg({ text: "I saw him", lang: "en", translations: { es: "Lo vi" } });
    expect(localizedText(english, "es", true)).toEqual({ text: "Lo vi", translatedFrom: "en" });
    expect(localizedText(english, "es", true, true)).toEqual({ text: "I saw him" });
    expect(localizedText(english, "es", false)).toEqual({ text: "I saw him" });
    expect(localizedText(english, "en", true)).toEqual({ text: "I saw him" });
    expect(localizedText(msg({ text: "Hi", lang: "en" }), "es", true)).toEqual({ text: "Hi", untranslatedFrom: "en" });
    expect(messagePreview(english, pet, "u_b", t, "es", true)).toBe("Ana R.: Lo vi");
    expect(messagePreview(english, pet, "u_a", t, "en", true)).toBe("Tú: I saw him");
    expect(messagePreview(undefined, pet, "u_a", t)).toBe("");
  });
});
