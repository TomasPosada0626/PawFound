# Gestión del proyecto

## Estado (3 de noviembre de 2026)

PawFound está en el **piloto de Android**:

- La app se instala como APK y se actualiza por EAS Update.
- La API, la base de datos y el sitio están en producción.
- El trabajo de las Fases 2 y 3 (diseño y MVP) se hizo en ramas `feature/<nombre>` con pull
  requests a `develop`, la mayoría sin enlazar un Issue.

Por eso los hitos de GitHub muestran Issues abiertos que ya están resueltos en el código. El historial
real está en los pull requests fusionados.

| Fase | Estado |
| --- | --- |
| 0 — Fundación | Hecha: gobernanza, documentación, legal y automatización base (v0.0.1) |
| 1 — Descubrimiento | Hecha: entrevistas y hallazgos en [docs/investigacion/](investigacion/) |
| 2 — Diseño | Hecha en la app: flujos, pantallas y accesibilidad |
| 3 — MVP | En producción para el piloto: API, app Android, PawFamily, moderación y sitio |
| 4 — Lanzamiento Android | Pendiente: prueba cerrada en Google Play, ficha de la tienda, dominio propio y revisión legal |

## Tablero

GitHub Project con las columnas `Backlog` → `Ready` → `In progress` → `In review` → `Done`. Cada
Issue lleva prioridad, estimación ligera y criterio de aceptación.

## Etiquetas

| Grupo | Etiquetas |
| --- | --- |
| Tipo | `type: feature`, `type: bug`, `type: docs`, `type: chore`, `type: epic` |
| Prioridad | `priority: critical`, `priority: high`, `priority: medium`, `priority: low` |
| Estado | `status: backlog`, `status: ready`, `status: in-progress`, `status: blocked`, `status: needs-triage` |
| Área | `area: product`, `area: design`, `area: backend`, `area: mobile`, `area: platform`, `area: security`, `area: legal` |
| Plataforma | `platform: android`, `platform: api`, `platform: infrastructure` |
| Seguridad y legal | `security`, `legal`, `privacy` |
| Estimación | `points: 1`, `points: 2`, `points: 3`, `points: 5`, `points: 8` |
| Dependencias | `dependency: blocked`, `dependency: external` |

## Hitos

1. **Fase 0 — Fundación**: visión, documentación, gobernanza y backlog inicial.
2. **Fase 1 — Descubrimiento**: investigación de usuarios, requisitos y definición del MVP.
3. **Fase 2 — Diseño**: flujos, prototipo y criterios de accesibilidad.
4. **Fase 3 — MVP (v0.1.0)**: implementación, pruebas y piloto.
5. **Fase 4 — Lanzamiento Android**: operación, métricas y mejora continua.

Las épicas (producto y descubrimiento, experiencia móvil, plataforma y datos, seguridad y privacidad,
operaciones de lanzamiento) son Issues de tipo `epic`; sus tareas las enlazan en la descripción.

## Flujo de trabajo

Ramas `feature/<nombre-corto>` desde `develop`, pull request a `develop` con el CI en verde, y de
`develop` a `main` cuando hay un conjunto listo para publicar. Al fusionar a `main` se publican la API
y el sitio, y después se lanza la actualización de la app. Detalle en
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Definición de listo

Un Issue está listo cuando tiene contexto, alcance, criterio de aceptación, riesgos conocidos y
dependencias identificadas.

## Definición de terminado

Una tarea está terminada cuando cumple sus criterios de aceptación, está revisada, documentada y
validada de forma proporcional al riesgo.

Para cualquier cambio de código (API, app o web), además:

- **Pruebas unitarias** de la lógica nueva o modificada.
- **Análisis estático** sin hallazgos nuevos sin resolver (linter y escáner de seguridad del lenguaje).
- **Pruebas de flujo completo** cuando el cambio toca un flujo de usuario: en la API contra PostGIS
  real y en la app sobre el router real.
- **Pruebas de vulnerabilidades** de dependencias (`govulncheck`, `npm audit`) antes de fusionar.
- **Cobertura** dentro del mínimo del CI: ≥ 90 % total en la API y ≥ 80 % de líneas y sentencias en la app.
- **Documentación** al día: contrato OpenAPI si cambia una ruta y los documentos afectados.

El detalle de herramientas por capa está en
[docs/ARCHITECTURE.md](ARCHITECTURE.md#calidad-pruebas-y-seguridad).
