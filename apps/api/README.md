# PawFound API

API en Go para PawFound: cuentas, reportes con PostGIS, Alerta Ángel, chats en tiempo real
con fotos, comunidad (insignias, "me gusta", reportes sin bloqueos) y el panel web de
moderación. Diseño completo en [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md); contrato
en [packages/contracts/openapi.yaml](../../packages/contracts/openapi.yaml).

## Requisitos

- Go 1.26.10+ (`go.mod` fija el toolchain; `go` lo descarga solo)
- Docker, para PostgreSQL/PostGIS local (ver [`infra/`](../../infra))

## Arrancar en local

```bash
docker compose -f infra/docker-compose.yml up -d     # desde la raíz del repo
cd apps/api
export DATABASE_URL="postgres://pawfound:pawfound@localhost:5432/pawfound?sslmode=disable"
export JWT_SECRET="$(openssl rand -base64 48)"
export DEV_FIXED_CODE=123456                         # opcional: código de verificación fijo para probar la app
go run ./cmd/api                                     # API en :8080, panel en /admin
```

En `development` las migraciones se aplican solas al arrancar, los códigos de verificación
(correo) y los push se escriben en el log (no salen a internet) y la cookie del panel funciona
sobre `http://localhost`.

## Comandos

```bash
go run ./cmd/api                                  # sirve API, panel y tareas periódicas
go run ./cmd/api migrate                          # aplica migraciones y termina
go run ./cmd/api grant-role ana@correo.co moderator  # acceso al panel (user|moderator|admin)
go run ./cmd/api import-places                    # veterinarias del Valle de Aburrá (OpenStreetMap)
go test ./...                                     # unitarias (las de integración se saltan)
TEST_DATABASE_URL=postgres://… go test ./...      # + integración y E2E contra PostGIS real
golangci-lint run                                 # lint + gosec (config en .golangci.yml)
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Para las pruebas de integración basta un PostGIS vacío; cada paquete crea su propia base
temporal:

```bash
docker run -d --name pawfound-test-db -e POSTGRES_USER=pawfound -e POSTGRES_PASSWORD=pawfound \
  -p 55432:5432 postgis/postgis:16-3.4
TEST_DATABASE_URL="postgres://pawfound:pawfound@localhost:55432/pawfound?sslmode=disable" go test ./...
```

## Estructura

```text
cmd/api/              entrypoint y subcomandos
internal/config       variables de entorno, con validaciones que impiden arrancar mal configurado
internal/db           pool de pgx y migraciones SQL embebidas (migrations/NNNN_*.sql)
internal/domain       reglas puras, gemelas de apps/mobile/src/domain (límite diario, insignias,
                      modo descanso, coincidencias)
internal/lifecircle   círculo de vida (vectores compartidos con la app)
internal/geo          ubicación aproximada a 250 m y distancias
internal/auth         Argon2id, JWT, refresh tokens rotativos, códigos de verificación (HMAC), OIDC Google/Apple
internal/app          casos de uso sobre PostgreSQL (la versión de servidor de mockBackend.ts)
internal/httpapi      API REST v1 y middleware (auth, límites, cabeceras de seguridad, logs)
internal/realtime     WebSocket: mensajes y notificaciones en vivo
internal/media        fotos: re-codificación sin EXIF/GPS, orientación, hash perceptual
internal/providers    correo (SMTP), push (Expo → FCM/APNs) y traducción detrás de interfaces
internal/jobs         Alerta Ángel que crece con el círculo y limpieza de datos vencidos
internal/admin        panel web de moderación (/admin), sin JavaScript
internal/testdb       base PostGIS aislada para las pruebas de integración
```

## Decisiones

- **SQL explícito con pgx**, sin ORM. Las consultas viven junto a cada caso de uso en
  `internal/app`; sqlc queda como opción si el número de consultas crece.
- **Fotos por la API**: la app sube la foto a `POST /v1/media` y la API la re-codifica antes
  de guardarla. Así se garantiza que nunca se guarde el GPS del celular aunque la app falle
  en quitarlo. El almacenamiento es local (`MEDIA_DIR`) hasta activar Cloudflare R2 detrás
  de la interfaz `media.Store`.
- **Verificación gratis por correo**: sin SMS. En producción, sin `SMTP_HOST` el registro
  responde `provider_unavailable`; cualquier proveedor SMTP sirve (varios tienen capa
  gratuita). Sin `PUSH_PROVIDER` las notificaciones quedan solo en la bandeja. Cada proveedor
  se activa tras su evaluación de privacidad.
- **Una sola instancia** para los límites en memoria (login, verificación, subidas). Los
  límites de negocio (2 reportes por día, 12 mensajes por minuto, 5 alertas por día) se
  cuentan en la base y valen con varias instancias.

## Estado

Implementado: issues #32 a #37 y #42, y la parte de servidor de #38, #39, #40, #43 y #45.
Pendiente de proveedor (cada uno con su evaluación de privacidad): correo SMTP, push por
Expo/FCM/APNs, Cloudflare R2, traducción automática de chats, Sentry (#41) y Upstash Redis
(#40). Facebook Login todavía no está implementado.
