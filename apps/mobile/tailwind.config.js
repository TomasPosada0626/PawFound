/** @type {import('tailwindcss').Config} */

// Colores semánticos vía variables CSS (definidas en global.css para claro y oscuro).
// Los valores en hex viven en src/theme/tokens.ts; un test verifica que ambos coincidan.
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Marca PawFound (ver Diseño ideal/ y assets/brand/logo.png)
        teal: "#1FA98F",
        navy: "#0B2545",
        bg: token("bg"),
        surface: token("surface"),
        "surface-alt": token("surface-alt"),
        border: token("border"),
        ink: token("ink"),
        body: token("body"),
        muted: token("muted"),
        primary: token("primary"),
        "primary-strong": token("primary-strong"),
        "primary-soft": token("primary-soft"),
        lost: token("lost"),
        "lost-soft": token("lost-soft"),
        "lost-ink": token("lost-ink"),
        found: token("found"),
        "found-soft": token("found-soft"),
        "found-ink": token("found-ink"),
        warning: token("warning"),
        "warning-soft": token("warning-soft"),
        danger: token("danger"),
        verified: token("verified"),
      },
      fontFamily: {
        regular: ["Nunito_400Regular"],
        semibold: ["Nunito_600SemiBold"],
        bold: ["Nunito_700Bold"],
        extrabold: ["Nunito_800ExtraBold"],
        black: ["Nunito_900Black"],
      },
    },
  },
  plugins: [],
};
