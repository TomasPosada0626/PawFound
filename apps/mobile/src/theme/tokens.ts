/**
 * Tokens de color de PawFound, fuente única para JS (íconos, mapa, StatusBar).
 * global.css replica estos valores como variables CSS para las clases de NativeWind;
 * `tokens.test.ts` verifica que no se desincronicen.
 *
 * Perdidas en rojo y encontradas en aguamarina, en toda la app (pines, anillos, etiquetas).
 * Contraste verificado contra docs/accesibilidad.md (WCAG 2.1 AA):
 * - `primaryStrong` #08807A (aguamarina profundo) sobre blanco: 4.8:1 (texto y enlaces).
 * - Botón primario: degradado #08807A → #065F69, texto blanco ≥ 4.8:1 en todo el recorrido.
 * - `lost` #E02424 (rojo) con texto blanco: 4.7:1; `lostInk` #B91C1C sobre blanco: 6.5:1.
 * El aguamarina de marca #12B3A6 solo da 2.6:1 sobre blanco: se usa para rellenos
 * decorativos (pines, anillos, íconos grandes), nunca como color de texto.
 */

export type ColorScheme = "light" | "dark";

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  ink: string;
  body: string;
  muted: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  lost: string;
  lostSoft: string;
  lostInk: string;
  found: string;
  foundSoft: string;
  foundInk: string;
  warning: string;
  warningSoft: string;
  danger: string;
  verified: string;
};

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    bg: "#F3F8F9",
    surface: "#FFFFFF",
    surfaceAlt: "#E9F5F5",
    border: "#D2E5E6",
    ink: "#13254A",
    body: "#2A3B55",
    muted: "#5D6C80",
    primary: "#12B3A6",
    primaryStrong: "#08807A",
    primarySoft: "#E0F6F3",
    lost: "#E02424",
    lostSoft: "#FDECEC",
    lostInk: "#B91C1C",
    found: "#08807A",
    foundSoft: "#E0F6F3",
    foundInk: "#076B67",
    warning: "#B45309",
    warningSoft: "#FEF3E2",
    danger: "#C81E1E",
    verified: "#1D6FE0",
  },
  dark: {
    bg: "#0A1520",
    surface: "#12202D",
    surfaceAlt: "#192A39",
    border: "#25394A",
    ink: "#E8F0F5",
    body: "#C9D6E0",
    muted: "#9DB0C0",
    primary: "#2CCFC0",
    primaryStrong: "#3CD5C4",
    primarySoft: "#0F3A39",
    lost: "#E02424",
    lostSoft: "#3A1416",
    lostInk: "#FF8A8A",
    found: "#08807A",
    foundSoft: "#0F3A39",
    foundInk: "#5EE3D3",
    warning: "#F5A524",
    warningSoft: "#3A2A10",
    danger: "#FF6B6B",
    verified: "#5AA2FF",
  },
};

/** Degradado del botón primario y del CTA "Reportar" (mismo en claro y oscuro). */
export const primaryGradient = ["#08807A", "#065F69"] as const;

/** Colores de estado de un caso, para pines y anillos (con texto/ícono, nunca solo color). */
export const statusColor = {
  lost: "#E02424",
  found: "#12B3A6",
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Touch target mínimo de Material (docs/accesibilidad.md). */
export const MIN_TOUCH = 48;

/** Convierte "#RRGGBB" al formato "R G B" que usan las variables CSS. */
export function hexToRgbChannels(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** Luminancia relativa WCAG de un color "#RRGGBB". */
export function relativeLuminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = hexToRgbChannels(hex)
    .split(" ")
    .map((c) => Number(c) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG entre dos colores "#RRGGBB". */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
