# Arquitectura técnica

> Decisiones ya tomadas en [docs/PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md) y [PRODUCT.md](../PRODUCT.md); este documento las desarrolla técnicamente. Se actualiza a medida que se implementan las épicas de la [wiki](https://github.com/TomasPosada0626/PawFound/wiki/Gobernanza-del-proyecto).

## Visión general

PawFound tiene dos componentes: una API en Go que expone el dominio (usuarios, mascotas, reportes, casos, grupos, mensajería) y una app Expo (React Native) para Android que la consume.

```text
┌─────────────────────┐        HTTPS/JSON        ┌──────────────────────┐
│   App Expo (Android) │ ────────────────────────▶│      API (Go)        │
│  mapa · reportes ·    │◀──────────────────────── │  auth · geoespacial · │
│  chats · perfil       │      push (FCM)          │  mensajería · moder. │
└─────────────────────┘                            └──────────┬───────────┘
                                                                │
                       ┌────────────────────────────────────────┼───────────────────────────┐
                       ▼                                        ▼                            ▼
              ┌─────────────────┐                    ┌──────────────────┐          ┌──────────────────┐
              │ PostgreSQL +     │                    │ Upstash Redis     │          │ Cloudflare R2      │
              │ PostGIS          │                    │ caché / rate limit│          │ imágenes (sin EXIF)│
              └─────────────────┘                    └──────────────────┘          └──────────────────┘
                                                                │
                                                                ▼
                                                       ┌──────────────────┐
                                                       │ Sentry (errores) │
                                                       └──────────────────┘
```

## Backend (API)

- **Lenguaje**: Go.
- **API HTTP**: router Chi, con contrato OpenAPI explícito y versionable.
- **Tiempo real**: WebSockets para mensajería (DM y grupos de caso).
- **Base de datos**: PostgreSQL con la extensión PostGIS, para modelar ubicación aproximada y resolver búsquedas por radio ("círculo de vida"). Hosting inicial: Supabase (Postgres + PostGIS, capa gratuita) para desarrollo/MVP; Supabase pausa proyectos tras una semana sin actividad, por lo que **no** es la solución definitiva de producción — reevaluar antes del lanzamiento público.
- **Acceso a datos**: pgx + sqlc (SQL explícito con generación de código tipado, sin ORM). Migraciones SQL versionadas y revisadas por PR; nunca cambios manuales directos en una base de datos de staging/producción.
- **Autenticación**: correo/contraseña (hash Argon2id) + OAuth (Google, Facebook, Apple) para el login; verificación de identidad por SMS en el registro, que al completarse otorga automáticamente la insignia azul. Sesión con JWT.
- **Imágenes**: subida directa del cliente a Cloudflare R2 mediante URLs firmadas — la API nunca recibe ni retransmite el archivo pesado. Se les quita metadata EXIF y se calcula un hash perceptual (pHash) para detectar duplicados/fraude antes de aceptar la publicación.
- **Límites de negocio en backend**: máximo 2 publicaciones por cuenta por día, validado en la API (nunca solo en el cliente).
- **Geoespacial**: cada mascota reportada tiene una ubicación aproximada y un radio de búsqueda que se expande automáticamente con el tiempo transcurrido desde el último avistamiento (regla exacta pendiente de [definir en producto](https://github.com/TomasPosada0626/PawFound/issues) — épica Producto y descubrimiento).
- **Mensajería**: modelo compartido para DMs y grupos; cada caso (mascota) crea automáticamente su grupo asociado ("Encontremos a [nombre]" / "Encontremos a su familia").
- **Moderación**: reglas descritas en [docs/legal/moderacion-y-ugc.md](legal/moderacion-y-ugc.md) — revisión proporcional al riesgo, no ocultamiento automático solo por volumen de reportes (3 reportes por sí solos no ocultan nada; se evalúan con señales adicionales, precisamente para evitar sabotaje coordinado).
- **Alerta Ángel**: envío de SMS geolocalizado a usuarios cercanos cuando se publica un reporte de mascota perdida, con enlace profundo (`https://pawfound.app/alerta/angel/<id>`) al detalle en la app.

## App (Expo / Android)

- **Framework**: Expo (React Native) + TypeScript + NativeWind (Tailwind para React Native). Lanzamiento inicial solo para Android; no se asume soporte iOS ni web hasta que se decida explícitamente. Idioma inicial español, inglés soportado desde el día uno (sin strings embebidos en componentes).
- **Certificate pinning**: mencionado como buena práctica de seguridad, pero es complejo bajo el flujo administrado de Expo — confirmar el flujo de build nativo elegido (EAS Build / bare workflow) antes de asumirlo como requisito duro.
- **Notificaciones**: FCM para Android. No se requiere APNs mientras el lanzamiento sea Android-only; si se agrega iOS más adelante, evaluar Expo Notifications para simplificar ambas plataformas.
- **Cliente API**: generado desde el contrato OpenAPI de la API, para evitar desincronización entre app y backend.
- **Navegación principal**: Inicio, Mapa, Reportar (`+`), Mensajes (DM / Grupos / Notificaciones), Perfil.
- **Tema**: soporta modo claro y modo oscuro.
- **Referencia visual**: las 16 pantallas de [`Diseño ideal/`](../Diseño%20ideal/) son la fuente de verdad del diseño hasta que exista un `DESIGN.md` formal (`/impeccable document` o `/impeccable new-work`).

## Proveedores externos

| Proveedor | Uso | Datos | Estado |
| --- | --- | --- | --- |
| Cloudflare R2 | Almacenamiento de imágenes | Archivos sin metadatos EXIF | Por evaluar |
| Firebase Cloud Messaging | Notificaciones push Android | Token de dispositivo y mensaje mínimo | Por evaluar |
| Upstash Redis | Caché y límites de uso (rate limiting) | Claves técnicas efímeras | Por evaluar |
| Sentry | Telemetría de errores | Telemetría minimizada | Por evaluar |

Ningún proveedor se activa en producción sin completar su evaluación de seguridad y privacidad — ver [docs/legal/incidentes-y-proveedores.md](legal/incidentes-y-proveedores.md).

## Principios de datos

- No se muestran coordenadas ni direcciones exactas por defecto; el mapa y los reportes trabajan con ubicación aproximada.
- Una publicación y su chat de caso se archivan al marcar la mascota como encontrada; no se eliminan automáticamente.
- Los consentimientos (ubicación, notificaciones) son granulares, revocables y auditables — ver [docs/legal/consentimientos.md](legal/consentimientos.md).

## Estructura del repositorio

Monorepo: `apps/mobile` (Expo/React Native), `apps/api` (Go), `packages/contracts`
(contrato OpenAPI compartido y cliente TypeScript generado), `infra` (Docker Compose,
migraciones, configuración de entornos). Se documenta ahora como estructura objetivo; se
crea cuando arranque el código real en Fase 3, no antes.

## Entornos

`local`, `staging` y `producción`, cada uno con su propia base de datos y sus propios
secretos — nunca compartidos ni mezclados entre entornos. Alertas de presupuesto/cuota
configuradas en cada proveedor gratuito desde el primer día (gratis no significa que no
pueda generar un cobro al superar el umbral).

## Fuera de alcance en v1

Deliberadamente no se usan microservicios, Kubernetes, GraphQL, Kafka ni IA de matching en
la primera versión — añaden complejidad antes de validar el producto.

## Entorno local y CI

- **Entorno local**: Docker Compose (API + PostgreSQL/PostGIS + Redis), sin depender de servicios en la nube para desarrollar.
- **Pruebas y CI**: GitHub Actions. `golangci-lint` + `gofumpt` + `go vet` en el backend; Renovate o Dependabot para mantener dependencias al día en ambos proyectos.
- **Backups**: exportables, con una prueba real de restauración antes del lanzamiento.
- **Antes del lanzamiento público**: pentest básico automatizado (OWASP ZAP); idealmente un servicio profesional pago antes de abrir la app al público general — más allá del escaneo de vulnerabilidades de dependencias que ya corre en cada PR.

## Estrategia de pruebas y seguridad

Barra de calidad obligatoria para todo código (no documentación), definida en
[docs/PROJECT_MANAGEMENT.md § Definición de terminado](PROJECT_MANAGEMENT.md#definición-de-terminado):
pruebas unitarias, análisis estático, pruebas end-to-end de flujos completos y pruebas de
vulnerabilidades, con cobertura ≥ 80 % en el código nuevo o modificado.

| Capa | Unitarias | Estático | E2E | Vulnerabilidades |
| --- | --- | --- | --- | --- |
| API (Go) | `go test` + testify | `golangci-lint` | pruebas de integración contra Postgres/PostGIS real (Docker Compose) | `govulncheck` (dependencias) + `gosec` (código) |
| App (Expo/RN/TS) | Jest + React Native Testing Library | ESLint + TypeScript en modo estricto | Detox o Maestro sobre los flujos completos (login→registro→reportar→chat de caso) | `npm audit` / Dependabot |
| Ambas | — | — | — | Revisión de secretos antes de cada commit (no commitear tokens ni credenciales) |

CI (GitHub Actions) ejecuta lint + pruebas unitarias + escaneo de vulnerabilidades en cada
PR hacia `develop`; los E2E de flujo completo corren al menos antes de cada fusión de
`develop` a `main` (cierre de fase). Un PR de código sin este checklist cubierto no se
fusiona — ver `.github/pull_request_template.md`.

## Decisiones ya resueltas

- Radio del "círculo de vida" **por perfil** (especie + si hubo evento traumático), no una sola fórmula — [issue #10](https://github.com/TomasPosada0626/PawFound/issues/10). Ver la tabla completa en [PRODUCT.md § Capabilities and Constraints](../PRODUCT.md#capabilities-and-constraints). Informado por literatura general de búsqueda de mascotas perdidas, no por consulta directa con un experto certificado.
- Ubicación en mapa/detalle: siempre aproximada, nunca dirección exacta por defecto; la dirección exacta solo se comparte manualmente por mensaje directo — [issue #46](https://github.com/TomasPosada0626/PawFound/issues/46).
- Métricas de éxito del MVP: tasa de reencuentro a 14 días como métrica principal — [issue #9](https://github.com/TomasPosada0626/PawFound/issues/9), detalle en [PRODUCT.md § Métricas de éxito](../PRODUCT.md#métricas-de-éxito-mvp).

## Decisiones abiertas

- Umbral y trámite vigente de registro ante el Registro Nacional de Bases de Datos (RNBD) de la SIC — verificar con asesoría legal.
- Tratamiento reforzado de datos de personas menores de edad — pendiente de definición legal.
