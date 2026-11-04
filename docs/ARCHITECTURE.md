# Arquitectura técnica

Cómo están hechas y cómo se conectan las piezas de PawFound. Las reglas de producto están en
[PRODUCT.md](../PRODUCT.md); cómo publicarlas y operarlas, en [DESPLIEGUE.md](DESPLIEGUE.md).

## Visión general

Tres aplicaciones en un monorepo:

- una **API en Go** que guarda y decide todo;
- una **app Expo** para Android (iOS después, con el mismo código);
- un **sitio en Astro** con la presentación, la ayuda, los documentos legales y la página pública de cada caso.

```text
                         HTTPS / JSON + WebSocket
 ┌──────────────────┐ ───────────────────────────▶ ┌────────────────────────────┐
 │ App Expo         │                              │ API Go (Render)            │
 │ Android          │ ◀─────────────────────────── │ REST /v1 · WS /v1/ws       │
 │ EAS Update (OTA) │   push: Expo Push → FCM      │ panel /admin · tareas      │
 └──────────────────┘                              └─────────────┬──────────────┘
          ▲                                                      │
          │ enlaces /mascota/<id>                                 │
 ┌────────┴──────────────────┐   GET /v1/pets/{id}   ┌───────────┼────────────────┬──────────────┬───────────────┐
 │ Sitio Astro               │ ───────────────────▶  ▼           ▼                ▼              ▼               ▼
 │ (Cloudflare Pages +       │               ┌──────────────┐ ┌───────────────┐ ┌───────────┐ ┌────────────┐ ┌──────────────┐
 │  función de Pages)        │               │ Neon         │ │ Cloudflare R2 │ │ Brevo     │ │ RUES       │ │ OpenStreetMap│
 └───────────────────────────┘               │ PostgreSQL + │ │ fotos sin     │ │ correo    │ │ datos.gov  │ │ (Overpass)   │
                                             │ PostGIS      │ │ EXIF ni GPS   │ │           │ │ refugios   │ │ veterinarias │
                                             └──────────────┘ └───────────────┘ └───────────┘ └────────────┘ └──────────────┘
```

Un servicio externo (cron-job.org) visita `/health` cada 5 minutos para que el plan gratuito
de Render no duerma la API. GitHub Actions corre el CI y, como respaldo, vigila la API y la
mantiene despierta.

## API (`apps/api`)

- **Go 1.26** con el router **chi** y SQL explícito con **pgx** (sin ORM). Las consultas viven
  junto a cada caso de uso en `internal/app`.
- **Migraciones** SQL versionadas y embebidas en el binario (`internal/db/migrations`, hoy
  0001 a 0017). Se aplican al arrancar (`MIGRATE_ON_START`) y nunca se cambia la base a mano.
- **Contrato**: [packages/contracts/openapi.yaml](../packages/contracts/openapi.yaml)
  documenta cada ruta. Los errores de negocio llegan como `{"error": {"code", "params"}}` con
  códigos que la app traduce.
- **Autenticación**:
  - contraseña con hash Argon2id y token de acceso JWT de 15 minutos;
  - refresh token opaco y rotativo, con un año de vida deslizante: la sesión nunca se cierra
    sola, solo cuando la persona la cierra;
  - el correo se verifica con un código de 6 dígitos, guardado como HMAC.

  Sin inicio de sesión con Google ni Apple (decisión del 2026-11-01): el código OIDC de la API
  queda sin uso.
- **Tiempo real**: WebSocket en `/v1/ws`; el token va en el primer mensaje, nunca en la URL.
  Llegan al instante los mensajes, los avisos, los casos nuevos y los cierres. `/v1/online`
  cuenta las personas conectadas.
- **Geoespacial**: PostGIS resuelve las búsquedas por radio. Toda ubicación pública se aproxima
  a celdas fijas de 250 m (deterministas, para que no se puedan promediar). El círculo de vida
  de una perdida crece con la raíz del tiempo desde el último avistamiento: 250 m al
  publicarse y 2 km a los 30 minutos. La fórmula se valida con los mismos vectores en la app y
  en la API ([fixtures](../packages/contracts/fixtures/)).
- **Fotos**: la app sube cada foto a `POST /v1/media` (máximo 8 MB). La API la decodifica, la
  orienta, la reduce a 1600 px y la vuelve a codificar en JPEG: nunca se guarda EXIF ni GPS,
  aunque la app falle en quitarlos.
  - Un hash perceptual detecta fotos casi idénticas de otra cuenta y abre un reporte de
    posible estafa.
  - Se guardan en Cloudflare R2 (o en `MEDIA_DIR` en local) y siempre las sirve la API: las de
    chat solo a los miembros del chat.
- **Mensajería**: un solo modelo para mensajes directos y grupos, con fotos y ubicación puntual.
  - Cada caso crea su grupo («Encontremos a…»).
  - Al cerrar el caso se cierran su grupo y sus mensajes directos, y se borran las coordenadas
    compartidas en ellos.
  - La ubicación solo va en mensajes directos, nunca en vivo.
  - Cada mensaje guarda su idioma. Hay una interfaz de traducción, pero sin proveedor
    configurado se muestra el original.
- **Alerta Ángel**:
  - Origen del punto: la app envía la ubicación aproximada al moverse unos 250 m, también en
    segundo plano. El servidor guarda solo el último punto (`alert_zones`) durante 30 días y
    lo borra al cerrar la última sesión.
  - Destinatarios: a quien esté a menos de 250 m le llega al publicarse el caso; a los demás,
    cuando el círculo de vida los alcanza.
  - Límites: una alerta por persona y caso, máximo 5 al día, en silencio en modo descanso.
- **Tareas periódicas** (`internal/jobs`, una sola instancia a la vez con un candado de la base):
  - el crecimiento de la Alerta Ángel y, con él, las coincidencias nuevas entre perdidas y encontradas;
  - los recordatorios del caso (3, 7 y 14 días) y el archivo a los 60 días;
  - las solicitudes de PawFamily que vencen a los 14 días y el seguimiento a los 7 y 30 días;
  - la revisión de refugios en el RUES;
  - la limpieza de sesiones, códigos y fotos sin usar.

  Corren cada 10 minutos si hubo actividad reciente y cada hora si no, para cuidar la cuota de Neon.
- **PawFamily**: publicaciones de adopción, solicitudes, chat al aceptar, seguimiento con foto y
  perfiles de refugio.
  - Los refugios se verifican solos con el RUES de Confecámaras (datos abiertos de
    datos.gov.co): una fundación, asociación o corporación activa con el mismo nombre y dígito
    de verificación queda verificada; si no, se rechaza diciendo por qué.
  - Si el RUES no responde se reintenta cada hora, y cada mes se revisan los verificados.
  - Un NIT verifica una sola cuenta (índice único en la base).
- **Comunidad**:
  - seguirse con solicitud aceptada;
  - «me gusta» libres desde el perfil;
  - calificaciones de ayuda al cerrar un caso, cuyo promedio solo se muestra desde la décima;
  - insignias calculadas en el servidor a partir de hechos; nunca se otorgan a mano.

  No hay bloqueos: se reporta y moderación decide.
- **Límites**:
  - los de negocio se cuentan en la base: 2 reportes por día, 12 mensajes por minuto y 5
    alertas por día;
  - los intentos de inicio de sesión, verificación y restablecimiento se cuentan en la base
    con un hash de la clave (sobreviven a los reinicios del plan gratuito); si la base falla,
    se cuentan en memoria.
- **Panel de moderación** (`/admin`), servido por la misma API y sin JavaScript:
  - seguridad: formularios con CSRF, cookie HttpOnly y SameSite=Strict, CSP estricta y segundo
    factor por correo;
  - herramientas: cola de reportes con contexto, historial de la persona, sanciones
    escalonadas (aviso, 24 horas, 7 días, suspensión), bitácora de solo inserción, actividad
    de la app y refugios;
  - aviso por correo a moderación y administración cuando llegan reportes: el primero al
    instante y, como mucho, uno cada 30 minutos con los que se acumulen.
- **Privacidad**: exportar los datos y eliminar la cuenta son autoservicio (`GET /v1/me/export`,
  `DELETE /v1/me`). Eliminar borra todo lo de la cuenta y confirma por correo.
- **Errores**: Sentry está integrado y apagado mientras no exista `SENTRY_DSN`.

## App (`apps/mobile`)

- **Expo SDK 57**, React Native, TypeScript estricto, NativeWind y expo-router. Español e inglés
  desde el primer día: ningún texto vive en un componente y TypeScript exige las mismas claves
  en los dos idiomas.
- **Dos backends con la misma interfaz** (`Backend`):
  - `ApiBackend` (`src/services/apiBackend.ts`, por partes en `src/services/api/`) habla con
    la API y se activa con `EXPO_PUBLIC_API_URL`.
  - `MockBackend` (`src/services/mockBackend.ts`, por partes en `src/services/mock/`) es una
    demostración en memoria con las mismas reglas.

  El cliente está escrito a mano: sus tipos (`src/domain/types.ts`) y el contrato OpenAPI se
  actualizan juntos en el mismo PR.
- **Reglas puras** en `src/domain` (círculo de vida, alertas, coincidencias, insignias,
  calificaciones), gemelas de `apps/api/internal/domain`.
- **Notificaciones**: `expo-notifications` con canales de Android separados («Alertas Ángel» y
  «Novedades de casos»). La API las envía por el servicio push de Expo, que en Android las
  entrega por FCM.
- **Ubicación en segundo plano** para la Alerta Ángel con una tarea de `expo-location`, sin
  servicio fijo en primer plano.
- **Actualizaciones**: EAS Update en el canal `preview`, con `runtimeVersion` por huella
  (*fingerprint*). Los cambios de JavaScript llegan sin reinstalar; los nativos piden un APK nuevo.
- **Mapa**: `react-native-maps` con Google Maps en Android. La clave sale de la variable
  `GOOGLE_MAPS_API_KEY` de EAS (`app.config.js`), nunca del repositorio.
- **Navegación**: Inicio, Mapa, Reportar (`+`), Mensajes y Perfil, más PawFamily desde Inicio.
  Modo claro y oscuro.
- **Errores**: Sentry opcional con `EXPO_PUBLIC_SENTRY_DSN`. Hoy no está configurado.

## Sitio web (`apps/web`)

Astro estático en Cloudflare Pages, sin rastreadores ni recursos de terceros:

- **Páginas**: presentación, guía, ayuda, privacidad y términos (leídos de `docs/legal/`),
  eliminar cuenta y restablecer contraseña. La página de restablecer envía la clave nueva
  directo a la API.
- **Caso compartido**: la función de Pages `functions/mascota/[id].js` arma
  `/mascota/<id>` con los datos públicos del caso (`GET /v1/pets/{id}`) y sus etiquetas Open
  Graph, y responde 404 si el caso ya no está disponible.
- **Enlaces a la app**: `.well-known/assetlinks.json` hace que esos enlaces abran la app instalada.

## Proveedores

El inventario completo, con qué datos recibe cada uno y su estado, está en
[docs/legal/incidentes-y-proveedores.md](legal/incidentes-y-proveedores.md). Ningún proveedor
se activa sin evaluar antes qué datos recibe.

## Principios de datos

- Nunca se muestran coordenadas ni direcciones exactas por defecto. La excepción es la ubicación
  que una persona envía en un mensaje directo, y la dirección de una adopción, que solo ven quien
  publica y la persona aceptada.
- El autor de un reporte aparece con nombre corto (por ejemplo, «Valentina A.»).
- Los consentimientos se guardan con fecha y versión del texto ([consentimientos](legal/consentimientos.md)).
- Retener lo mínimo: la ubicación para alertas es solo el último punto, los códigos vencen en un
  día y los respaldos cifrados en 30.

## Calidad, pruebas y seguridad

| Capa | Pruebas | Estático | Vulnerabilidades |
| --- | --- | --- | --- |
| API (Go) | `go test` con pruebas de integración y de flujo completo contra PostGIS real; cobertura total ≥ 90 % (CI) | `go vet`, `gofmt`, `golangci-lint` (con gofumpt y gosec) | `govulncheck` |
| App (Expo) | Jest + React Native Testing Library, con los flujos completos sobre el router real; cobertura ≥ 80 % de líneas y sentencias | TypeScript estricto, ESLint, Prettier, `expo install --check` | `npm audit` (bloquea críticos) |
| Web (Astro) | `node --test` de la función del caso compartido y `npm run build` | — | `npm audit` (bloquea altos) |

El CI (`.github/workflows/ci.yml`) corre todo en cada PR, y `quality.yml` valida el Markdown.
Renovate mantiene las dependencias al día. Falta la capa de pruebas en un dispositivo real
(Maestro o Detox), que necesita un emulador en el CI.

## Entornos

- **Local**: Docker Compose con PostGIS, la API con `APP_ENV=development` (los correos y push se
  escriben en el log) y la app en modo demostración o apuntando a la API local.
- **Producción**: Render, Neon, R2, Cloudflare Pages y Brevo, con secretos propios.

No hay `staging` todavía. Cada entorno tiene su base y sus secretos, que nunca se mezclan ni se
suben al repositorio (es público).

## Fuera de alcance

Sin microservicios, Kubernetes, GraphQL, colas ni IA de coincidencias: añaden complejidad antes
de validar el producto con el piloto.

## Decisiones abiertas

- Umbral y trámite vigente del Registro Nacional de Bases de Datos (RNBD) de la SIC: confirmar
  con asesoría legal.
- Tratamiento reforzado de datos de menores de edad: pendiente de definición legal.
- Dominio propio: sin él, los correos llegan a spam con más facilidad.
