# Contratos

`openapi.yaml` es la fuente de verdad del contrato HTTP entre `apps/api` y `apps/mobile`.

## Regla

Cualquier endpoint nuevo o cambiado se define primero acá, en el PR correspondiente de la
API. El cliente TypeScript de la app (`apps/mobile`) se genera desde este archivo — no se
escriben tipos de API a mano en la app, para que móvil y backend no se desincronicen.

## Generar el cliente (cuando exista `apps/mobile`)

```bash
npx openapi-typescript packages/contracts/openapi.yaml -o apps/mobile/src/api/schema.ts
```

## Estado

Solo documenta `GET /health`. Cada endpoint nuevo del backlog (esquema de datos, auth,
reportes, chat, etc.) agrega su `path` acá en el mismo PR que lo implementa en `apps/api`.
