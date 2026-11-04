# Contratos

`openapi.yaml` documenta el contrato HTTP entre `apps/api` y `apps/mobile`: cada ruta de
`apps/api/internal/httpapi/server.go`, con lo que recibe, lo que responde y sus códigos de error.

## Regla

Una ruta nueva o cambiada se documenta acá en el mismo PR que la implementa en la API. El cliente
de la app está escrito a mano (`apps/mobile/src/services/apiBackend.ts`, con los tipos de
`src/domain/types.ts` y `src/services/backendTypes.ts`), así que ese PR actualiza también la app:

- los tipos de lo que llega y se envía;
- un código de error nuevo en `ErrorCode` y en `KNOWN_CODES` (si falta, la app lo muestra como
  error genérico);
- el modo demostración (`mockBackend.ts`), que implementa la misma interfaz.

## Verificar

Para ver el contrato con una interfaz, se puede abrir el archivo en
[editor.swagger.io](https://editor.swagger.io) o en cualquier visor de OpenAPI 3.1. Para comprobar
que ninguna ruta de la API quedó sin documentar, compara las rutas de `server.go` con las de
`openapi.yaml`: al 3 de noviembre de 2026 coinciden todas (77 rutas, 92 operaciones).

## Vectores compartidos

[`fixtures/`](fixtures/) guarda los casos de prueba que la app y la API validan por igual, para que
una regla de negocio no pueda divergir entre los dos lados.
