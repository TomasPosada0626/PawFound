# Guía de contribución

Gracias por ayudar a construir PawFound.

## Antes de empezar

- Revisa los Issues abiertos y evita duplicar trabajo.
- Explica el problema y la propuesta antes de hacer cambios grandes.
- Mantén cada contribución pequeña, enfocada y verificable.

## Ramas

```text
main                 producción: la API (Render) y el sitio (Cloudflare Pages) se publican desde aquí
└── develop          integra el trabajo terminado
    └── feature/<nombre-corto>   o feature/<issue>-<nombre-corto>
```

1. Crea tu rama desde `develop`.
2. Haz el cambio con sus pruebas y su documentación.
3. Abre un pull request hacia `develop` con la plantilla, enlazando el Issue si lo hay.
4. El CI debe pasar completo antes de fusionar. La persona que mantiene el proyecto revisa y fusiona.
5. Cuando `develop` está listo para salir, se abre un pull request de `develop` a `main`. Al fusionarlo
   se publican la API y el sitio, y luego se lanza la actualización de la app (EAS Update).

## Antes de abrir el PR

Corre lo mismo que el CI en la parte que tocaste:

| Parte | Comandos |
| --- | --- |
| API (`apps/api`) | `go vet ./...`, `golangci-lint run` y `go test ./...` con `TEST_DATABASE_URL` (cobertura total ≥ 90 %) |
| App (`apps/mobile`) | `npx tsc --noEmit`, `npm run lint`, Prettier y `npm run test:coverage` (≥ 80 % de líneas y sentencias) |
| Web (`apps/web`) | `npm test` y `npm run build` |
| Documentación | `npx markdownlint-cli2 "**/*.md"` (reglas en `.markdownlint-cli2.yaml`) |

Si cambias una ruta de la API, actualiza en el mismo PR
[`packages/contracts/openapi.yaml`](packages/contracts/openapi.yaml) y el cliente de la app (ver su
[README](packages/contracts/README.md)). Si cambias una regla compartida (círculo de vida,
coincidencias), actualiza los vectores de `packages/contracts/fixtures/` y que pasen los dos lados.

## Estándares

- Documentación, textos de la app y mensajes de commit en español. Los textos de la app van en
  `src/i18n/es.ts` y `en.ts`, nunca dentro de los componentes.
- Mensajes de commit con prefijo: `feat:`, `fix:`, `docs:`, `test:`, `style:`, `chore:`.
- **Nunca subas secretos**: el repositorio es público. Las claves van en EAS, Render, Cloudflare o
  GitHub Secrets, y en local en archivos ignorados (`.env`, `.env.local`).
- No publiques datos personales, ubicaciones precisas ni información sensible de mascotas o personas,
  tampoco en pruebas o capturas.
- Nada de textos falsos: sin datos de demostración en producción ni promesas que la app no cumpla.
- Conserva la accesibilidad ([docs/accesibilidad.md](docs/accesibilidad.md)), la privacidad y la
  seguridad como requisitos de producto.
- Sigue el [Código de conducta](CODE_OF_CONDUCT.md).

## Propuestas grandes

Para cambios de alcance, arquitectura o políticas, abre primero un Issue de propuesta con la
motivación, las alternativas y los riesgos.
