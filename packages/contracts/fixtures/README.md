# Fixtures compartidos

Vectores de prueba que la app (`apps/mobile`) y la API (`apps/api`) validan por igual, para
que una regla de negocio no pueda divergir entre cliente y servidor.

- `life-circle.json`: radio del círculo de vida por perfil y horas transcurridas
  (PRODUCT.md, issue #10). Si cambia la tabla, se regenera este archivo y ambos lados
  deben seguir pasando sus pruebas.
- `owned-matches.json`: cuándo un reporte de mascota encontrada se parece lo suficiente a una
  de "Mis mascotas" como para preguntarle a su familia "¿es la tuya?", con su puntaje
  (`apps/mobile/src/domain/matching.ts` y `apps/api/internal/domain/matching.go`). Para
  regenerar los puntajes tras cambiar la regla: `go test ./internal/domain -run Owned -update`.
