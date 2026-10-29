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
- **Acceso a datos**: pgx con SQL explícito (sin ORM) junto a cada caso de uso en `apps/api/internal/app`; sqlc queda como opción si las consultas crecen. Migraciones SQL versionadas y embebidas en el binario (`internal/db/migrations`), revisadas por PR; nunca cambios manuales directos en una base de datos de staging/producción.
- **Autenticación**: correo o nombre de usuario y contraseña (hash Argon2id) + Google y Apple (OIDC); el correo se verifica con un código de 6 dígitos, que al completarse otorga automáticamente la insignia azul (las cuentas de Google y Apple llegan verificadas). Sesión con JWT.
- **Imágenes**: la app sube cada foto a `POST /v1/media` (máx. 8 MB) y la API la decodifica, aplica la orientación, la redimensiona a 1600 px y la re-codifica como JPEG: el archivo guardado nunca conserva EXIF ni GPS, aunque la app falle en quitarlos. Se calcula un hash perceptual; una foto casi idéntica a la de otra cuenta abre un reporte automático de posible estafa. Cambio frente a la idea inicial de subir directo a R2 con URL firmada: así la limpieza de metadatos está garantizada en el servidor. El almacenamiento es local hasta activar R2 detrás de `media.Store`. Las fotos de chat solo las ven los miembros del chat.
- **Límites de negocio en backend**: máximo 2 publicaciones por cuenta por día, validado en la API (nunca solo en el cliente).
- **Geoespacial**: cada mascota reportada tiene una ubicación aproximada y un radio de búsqueda que se expande automáticamente con el tiempo transcurrido desde el último avistamiento (regla exacta pendiente de [definir en producto](https://github.com/TomasPosada0626/PawFound/issues) — épica Producto y descubrimiento).
- **Mensajería**: modelo compartido para DMs y grupos, con fotos; cada caso (mascota) crea automáticamente su grupo asociado ("Encontremos a [nombre]" / "Encontremos a su familia"). Tiempo real por WebSocket (`/v1/ws`): el token se envía en el primer mensaje, nunca en la URL.
- **Panel de moderación**: web en `/admin`, servido por la misma API, sin JavaScript (formularios con CSRF, cookie HttpOnly/SameSite=Strict, CSP estricta). Cola de reportes con el mensaje reportado y su contexto, historial de la persona, sanción sugerida (aviso → 24 h → 7 días → suspensión) y bitácora de solo inserción. El acceso se otorga con `api grant-role <correo> moderator`.
- **Alertas por ubicación real**: la app envía su punto en segundo plano solo al moverse ~250 m (tarea de `expo-location`, sin servicio fijo); la API guarda el último punto aproximado en `alert_zones` y lo deja de usar a las 24 h sin actualizar. Alcance: `max(250 m, círculo de vida)`.
- **Verificación por correo**: código de 6 dígitos guardado como HMAC (`email_verifications`), enviado por SMTP con cualquier proveedor; en desarrollo se escribe en el log.
- **App ↔ API**: `apps/mobile/src/services/apiBackend.ts` implementa la misma interfaz que el backend de demostración (`Backend`) y se activa con `EXPO_PUBLIC_API_URL`.
- **Veterinarias**: tabla `places`, importada de OpenStreetMap con `api import-places` (atribución ODbL obligatoria). Sin refugios: en Medellín no reciben mascotas encontradas. La app pide la lista con una celda aproximada de 1 km y calcula las distancias en el celular; "Vamos" abre la ruta en Waze, Google Maps o Mapas de Apple con un enlace universal (sin API de pago).
- **Ubicación en el chat**: mensajes `location` (migración 0003). La ubicación actual y el punto de encuentro solo van en mensajes directos y no son en vivo; la veterinaria a donde se lleva una mascota también puede ir al grupo del caso (nombre y punto salen de `places`). Dejan de verse, y se borran sus coordenadas, cuando quien la envió la quita (`DELETE /messages/{id}/location`), al cerrar el mensaje directo o al cerrarse el caso.
- **Sitio web**: `apps/web` (Astro, estático, sin rastreadores) con la landing, la guía, la ayuda, los documentos legales y el destino de los enlaces compartidos.
- **Moderación**: reglas descritas en [docs/legal/moderacion-y-ugc.md](legal/moderacion-y-ugc.md) — revisión proporcional al riesgo, no ocultamiento automático solo por volumen de reportes (3 reportes por sí solos no ocultan nada; se evalúan con señales adicionales, precisamente para evitar sabotaje coordinado).
- **Traducción de chats**: cada mensaje guarda el idioma de quien lo escribió (`lang`) y la API
  lo traduce una sola vez hacia cada idioma presente entre los miembros del hilo
  (`translations`). La app muestra la traducción al idioma de quien lee, con "Ver original"
  y un interruptor para desactivarla. El proveedor (DeepL, Google o un LLM) recibe contenido
  de chat, así que queda sujeto a la misma evaluación de privacidad que los demás proveedores
  antes de activarse; sin proveedor, los mensajes se muestran en su idioma original.
- **Alerta Ángel**: notificación push (no SMS) a los celulares cuya zona de alertas aproximada queda dentro del círculo de vida de una mascota perdida: al publicarse (círculo inicial) y luego por un job periódico a medida que el círculo crece. Una alerta por persona y caso, máximo 5 por día, respetando el modo descanso. El push abre `/alerta/angel/<id>` (también enlace universal `https://pawfound.app/alerta/angel/<id>`). Reglas en `apps/mobile/src/domain/alerts.ts`, para portarlas igual a la API.
- **Antispam y convivencia**: no existen bloqueos entre personas; se reporta (`userReports`) y moderación decide. La API limita mensajes por minuto por cuenta (Upstash Redis) y aplica restricciones temporales para escribir (`mutedUntil`).
- **Insignias y "me gusta"**: calculadas en el servidor a partir de hechos (reportes, avistamientos, agradecimientos al cerrar un caso, casos compartidos, grupos); la app solo las muestra. Los "me gusta" de perfil son uno por cuenta verificada.

## App (Expo / Android)

- **Framework**: Expo (React Native) + TypeScript + NativeWind (Tailwind para React Native). Lanzamiento inicial en Android; iOS llega más adelante y debe comportarse igual (ya están `ios.bundleIdentifier` y `associatedDomains` en `app.json`, y la lógica no depende de la plataforma). Web solo para desarrollo de UI. Idioma inicial español, inglés soportado desde el día uno (sin strings embebidos en componentes).
- **Certificate pinning**: mencionado como buena práctica de seguridad, pero es complejo bajo el flujo administrado de Expo — confirmar el flujo de build nativo elegido (EAS Build / bare workflow) antes de asumirlo como requisito duro.
- **Notificaciones**: `expo-notifications` en la app (mismo código para Android e iOS), con canales de Android separados ("Alertas Ángel" y "Novedades de casos"). La API envía por FCM (Android) y APNs (iOS, vía FCM o el servicio push de Expo), sujeto a la evaluación del proveedor (issue #39). En modo demostración la app presenta notificaciones locales.
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

- Fórmula del círculo de vida compartida entre app y API mediante vectores de prueba en
  [`packages/contracts/fixtures/life-circle.json`](../packages/contracts/fixtures/life-circle.json):
  `apps/mobile/src/domain/lifeCircle.ts` y `apps/api/internal/lifecircle` validan contra el
  mismo archivo. La aproximación de ubicación (celdas fijas de 250 m, deterministas para que
  no se puedan promediar) está implementada igual en ambos lados.

- Radio del "círculo de vida" **por perfil** (especie + si hubo evento traumático), no una sola fórmula — [issue #10](https://github.com/TomasPosada0626/PawFound/issues/10). Ver la tabla completa en [PRODUCT.md § Capabilities and Constraints](../PRODUCT.md#capabilities-and-constraints). Informado por literatura general de búsqueda de mascotas perdidas, no por consulta directa con un experto certificado.
- Ubicación en mapa/detalle: siempre aproximada, nunca dirección exacta por defecto; la dirección exacta solo se comparte manualmente por mensaje directo — [issue #46](https://github.com/TomasPosada0626/PawFound/issues/46).
- Métricas de éxito del MVP: tasa de reencuentro a 14 días como métrica principal — [issue #9](https://github.com/TomasPosada0626/PawFound/issues/9), detalle en [PRODUCT.md § Métricas de éxito](../PRODUCT.md#métricas-de-éxito-mvp).

## Decisiones abiertas

- Umbral y trámite vigente de registro ante el Registro Nacional de Bases de Datos (RNBD) de la SIC — verificar con asesoría legal.
- Tratamiento reforzado de datos de personas menores de edad — pendiente de definición legal.
