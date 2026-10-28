/**
 * Tokens de color de PawFound, fuente única para JS (íconos, mapa, StatusBar).
 * global.css replica estos valores como variables CSS para las clases de NativeWind;
 * `tokens.test.ts` verifica que no se desincronicen.
 *
 * Contraste verificado contra docs/accesibilidad.md (WCAG 2.1 AA):
 * - `primaryStrong` #0E7C6B sobre blanco: 5.1:1 (texto y enlaces teal).
 * - Botón primario: degradado #0E8572 → #0B6E60, texto blanco ≥ 4.5:1 en todo el recorrido.
 * - `lost` #D63A4E con texto blanco: 4.6:1.
 * El teal de marca #1FA98F solo da 2.9:1 sobre blanco: se usa para rellenos
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
    bg: "#F4F9F8",
    surface: "#FFFFFF",
    surfaceAlt: "#EEF6F4",
    border: "#D5E6E2",
    ink: "#0B2545",
    body: "#24364B",
    muted: "#5B6B7F",
    primary: "#1FA98F",
    primaryStrong: "#0E7C6B",
    primarySoft: "#E3F5F1",
    lost: "#D63A4E",
    lostSoft: "#FDECEE",
    lostInk: "#B42335",
    found: "#0E7C6B",
    foundSoft: "#E3F5F1",
    foundInk: "#0B6E60",
    warning: "#B45309",
    warningSoft: "#FEF3E2",
    danger: "#C8283D",
    verified: "#1D6FE0",
  },
  dark: {
    bg: "#0B1622",
    surface: "#13212F",
    surfaceAlt: "#1A2B3B",
    border: "#26394B",
    ink: "#E8F0F5",
    body: "#C9D6E0",
    muted: "#9DB0C0",
    primary: "#2BC4A6",
    primaryStrong: "#3CCFB0",
    primarySoft: "#123A36",
    lost: "#D63A4E",
    lostSoft: "#3A1820",
    lostInk: "#FF8A98",
    found: "#0E7C6B",
    foundSoft: "#123A36",
    foundInk: "#5FDCC0",
    warning: "#F5A524",
    warningSoft: "#3A2A10",
    danger: "#FF6B7D",
    verified: "#5AA2FF",
  },
};

/** Degradado del botón primario y del CTA "Reportar" (mismo en claro y oscuro). */
export const primaryGradient = ["#0E8572", "#0B6E60"] as const;

/** Colores de estado de un caso, para pines y anillos (con texto/ícono, nunca solo color). */
export const statusColor = {
  lost: "#D63A4E",
  found: "#1FA98F",
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
