# Fixtures compartidos

Vectores de prueba que la app (`apps/mobile`) y la API (`apps/api`) validan por igual, para
que una regla de negocio no pueda divergir entre cliente y servidor.

- `life-circle.json`: radio del círculo de vida por perfil y horas transcurridas
  (PRODUCT.md, issue #10). Si cambia la tabla, se regenera este archivo y ambos lados
  deben seguir pasando sus pruebas.
