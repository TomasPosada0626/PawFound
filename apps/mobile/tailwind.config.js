/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Marca PawFound (ver Diseño ideal/ y assets/brand/logo.png)
        teal: "#1FA98F",
        navy: "#0B2545",
      },
    },
  },
  plugins: [],
};
