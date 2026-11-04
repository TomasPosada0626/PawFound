# PawFound · sitio web

Sitio de [pawfound.pages.dev](https://pawfound.pages.dev), hecho con [Astro](https://astro.build) y
publicado en Cloudflare Pages.

## Qué tiene

- **Páginas**:
  - presentación con cómo funciona, el círculo de vida, PawFamily y la comunidad;
  - guía («se me perdió», «encontré una», adoptar);
  - ayuda con preguntas frecuentes;
  - [privacidad](https://pawfound.pages.dev/privacidad) y [términos](https://pawfound.pages.dev/terminos), que se leen de `docs/legal/`;
  - cómo eliminar la cuenta;
  - la página para restablecer la contraseña, que envía la clave nueva directo a la API.
- **Caso compartido** (`/mascota/<id>`): es el destino de los enlaces y de los QR de los afiches.
  - La función de Cloudflare Pages `functions/mascota/[id].js` toma la plantilla `/mascota/`, pide el caso a la API (`GET /v1/pets/{id}`) y la completa con su foto, nombre y zona, también en la vista previa de WhatsApp (etiquetas Open Graph).
  - Si el caso ya no está disponible responde 404 con un aviso; si la API no contesta, entrega la plantilla genérica con el botón para abrir la app.
  - La lógica vive en `lib/caso.js`, con sus pruebas en `lib/caso.test.js`.
- **Enlaces a la app**: `public/.well-known/assetlinks.json` lleva la huella del certificado de firma de Android, para que los enlaces abran la app instalada.
- **Seguridad**: `public/_headers` define una CSP estricta y las demás cabeceras. No hay rastreadores, analítica ni recursos de terceros: la fuente Nunito se sirve desde el mismo dominio.

## Comandos

```bash
npm install
npm run dev       # http://localhost:4321
npm test          # pruebas de la función del caso (node --test)
npm run build     # genera dist/
npm run preview
```

Para probar la función de Pages en local: `npx wrangler pages dev dist` después del build.

## Publicar

Cloudflare Pages con directorio raíz `apps/web`, comando `npm run build` y salida `dist`. Cada push a
`main` publica solo. La variable `API_URL` de Pages cambia la API que consulta la función; por defecto
usa la de producción. Pasos completos en [docs/DESPLIEGUE.md § 1](../../docs/DESPLIEGUE.md#1-sitio-web-cloudflare-pages).

Pendiente al publicar en las tiendas:

- Reemplazar los botones de `src/components/StoreButtons.astro` por las insignias oficiales de
  Google Play y App Store, con el enlace a la ficha.
- Agregar a `assetlinks.json` la huella de la firma de Google Play, y publicar
  `apple-app-site-association` (iOS, con el Team ID).
- La política de privacidad y los términos están pendientes de revisión legal formal.
