# PawFound · sitio de lanzamiento

Sitio estático de `pawfound.app` hecho con [Astro](https://astro.build): presentación de
lanzamiento, cómo funciona, el círculo de vida, el tutorial de primera vez, la guía ("se me
perdió", "encontré una"), ayuda, y la política de privacidad y los términos (se leen de
`docs/legal/`). También es el destino de los enlaces compartidos y de los QR de los afiches:
`/mascota/<id>` abre el caso en la app o lleva a la tienda.

No usa rastreadores, analítica ni recursos de terceros: la fuente Nunito se sirve desde el
mismo dominio y las capturas se optimizan en el build (WebP).

## Comandos

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # genera dist/
npm run preview
```

## Publicar

Cualquier hosting estático sirve (por ejemplo, Cloudflare Pages o Netlify, ambos con capa
gratuita): directorio de build `dist/`. `public/_redirects` envía `/mascota/*` a la página del
caso compartido.

Pendiente al publicar la app:

- Reemplazar los botones de tienda de `src/components/StoreButtons.astro` por las insignias
  oficiales de Google Play y App Store (cada tienda exige su arte) con el enlace a la ficha.
- Publicar en `public/.well-known/` los archivos que verifican los enlaces universales:
  `assetlinks.json` (Android, con la huella SHA-256 del certificado de firma) y
  `apple-app-site-association` (iOS, con el Team ID). Sin ellos, los enlaces abren esta web en
  vez de la app.
- La política de privacidad y los términos son borradores pendientes de revisión legal.
