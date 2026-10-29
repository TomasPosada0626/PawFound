# Gestión del proyecto

## Tablero recomendado

Usa un GitHub Project con las columnas:

`Backlog` → `Ready` → `In progress` → `In review` → `Done`

Cada Issue debe tener responsable, prioridad, estimación ligera y criterio de aceptación.

## Etiquetas

Crear y mantener estas etiquetas:

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

## Hitos iniciales

1. **Fase 0 — Fundación**: visión, documentación, gobernanza y backlog inicial.
2. **Fase 1 — Descubrimiento**: investigación de usuarios, requisitos y definición de MVP.
3. **Fase 2 — Diseño**: flujos, prototipo y criterios de accesibilidad.
4. **Fase 3 — MVP (v0.1.0)**: implementación, pruebas y piloto.
5. **Fase 4 — Lanzamiento Android**: operación, métricas y mejora continua.

## Épicas y cadencia

Las épicas agrupan resultados verificables: producto y descubrimiento, experiencia móvil,
plataforma y datos, seguridad y privacidad, y operaciones de lanzamiento. Cada épica se
representa con una Issue de tipo `epic`; sus tareas enlazan la épica en la descripción.

Los sprints tienen dos semanas. La planificación selecciona únicamente issues `ready`, con
dependencias resueltas y capacidad explícita. La revisión del sprint verifica los criterios
de aceptación y la retrospectiva registra mejoras accionables.

## Backlog inicial

| Orden | Resultado | Prioridad | Puntos | Fase |
| --- | --- | --- | --- | --- |
| 1 | Gobernanza, seguridad, legal y automatización base | alta | 5 | 0 |
| 2 | Investigación de cuidadores, refugios y validación de MVP | alta | 5 | 1 |
| 3 | Flujos de reporte, búsqueda, chat y accesibilidad | alta | 8 | 2 |
| 4 | API Go, PostgreSQL/PostGIS, autenticación y moderación | crítica | 8 | 3 |
| 5 | App Expo Android: feed, mapa, reporte y chat | crítica | 8 | 3 |
| 6 | Alertas consentidas, imágenes seguras y observabilidad | crítica | 8 | 3 |
| 7 | Piloto, soporte, operación y publicación Android | alta | 5 | 4 |

## Definición de listo

Un Issue está listo cuando tiene contexto, alcance, criterio de aceptación, riesgos conocidos y dependencias identificadas.

## Definición de terminado

Una tarea está terminada cuando cumple sus criterios de aceptación, está revisada, documentada y validada de forma proporcional al riesgo.

Para cualquier cambio de código (API o app; no aplica a documentación pura), además:

- **Pruebas unitarias** de la lógica nueva o modificada.
- **Análisis estático** sin hallazgos nuevos sin resolver (linter + escáner de seguridad del lenguaje correspondiente).
- **Pruebas end-to-end** del flujo completo afectado, no solo de la unidad aislada, cuando el cambio toca un flujo de usuario.
- **Pruebas de vulnerabilidades** (dependencias y, cuando aplique, el propio código) antes de fusionar a `develop`.
- **Cobertura de pruebas ≥ 80 %** en el código nuevo o modificado del módulo tocado.

El detalle de herramientas por capa está en [docs/ARCHITECTURE.md](ARCHITECTURE.md#estrategia-de-pruebas-y-seguridad).
