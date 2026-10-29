import { defineConfig } from "astro/config";

// Sitio estático de lanzamiento (pawfound.app). Sin rastreadores ni recursos de terceros: la
// fuente se sirve desde el mismo dominio. Los documentos legales se leen de docs/legal.
export default defineConfig({
  // Sin dominio propio: la dirección gratuita de Cloudflare Pages (SITE_URL en el build).
  site: process.env.SITE_URL ?? "https://pawfound.app",
  vite: { server: { fs: { allow: ["../.."] } } },
});
