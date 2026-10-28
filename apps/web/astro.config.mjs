import { defineConfig } from "astro/config";

// Sitio estático de lanzamiento (pawfound.app). Sin rastreadores ni recursos de terceros: la
// fuente se sirve desde el mismo dominio. Los documentos legales se leen de docs/legal.
export default defineConfig({
  site: "https://pawfound.app",
  vite: { server: { fs: { allow: ["../.."] } } },
});
