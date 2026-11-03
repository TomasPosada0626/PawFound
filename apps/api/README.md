# PawFound API

API en Go de PawFound. Cubre:

- cuentas verificadas por correo;
- reportes con PostGIS, círculo de vida y Alerta Ángel;
- chats en tiempo real con fotos;
- comunidad: seguidores, «me gusta», calificaciones e insignias;
- PawFamily (adopción y refugios verificados con el RUES);
- el panel web de moderación.

El diseño completo está en [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) y el contrato en
[packages/contracts/openapi.yaml](../../packages/contracts/openapi.yaml). En producción corre en
Render: [pawfound-api.onrender.com](https://pawfound-api.onrender.com/health).

## Requisitos

- Go 1.26.10+ (`go.mod` fija el toolchain; `go` lo descarga solo).
- Docker, para PostgreSQL con PostGIS (ver [`infra/`](../../infra)).

## Arrancar en local

```bash
docker compose -f infra/docker-compose.yml up -d     # desde la raíz del repo
cd apps/api
export DATABASE_URL="postgres://pawfound:pawfound@localhost:5432/pawfound?sslmode=disable"
export JWT_SECRET="$(openssl rand -base64 48)"
export DEV_FIXED_CODE=123456                         # opcional: código de verificación fijo para probar la app
go run ./cmd/api                                     # API en :8080, panel en /admin
```

En `development`:

- las migraciones se aplican solas al arrancar;
- los códigos de verificación, los correos y los push se escriben en el log, sin salir a internet;
- la cookie del panel funciona sobre `http://localhost`.

Todas las variables están explicadas en [`infra/.env.example`](../../infra/.env.example).

## Comandos

```bash
go run ./cmd/api                                     # sirve la API, el panel y las tareas periódicas
go run ./cmd/api migrate                             # aplica las migraciones y termina
go run ./cmd/api grant-role ana@correo.co moderator  # acceso al panel (user | moderator | admin)
go run ./cmd/api import-places                       # veterinarias del Valle de Aburrá (OpenStreetMap)
go run ./cmd/api fundador <usuario>                  # etiqueta la cuenta de quien creó PawFound
go run ./cmd/api limpiar-pruebas                     # muestra qué borraría; con --confirmar, lo borra
```

Para correrlos contra producción, ver [docs/DESPLIEGUE.md § 11](../../docs/DESPLIEGUE.md#11-comandos-de-administración).

## Pruebas y calidad

```bash
go test ./...                                        # unitarias (las de integración se saltan)
golangci-lint run                                    # lint, gofumpt y gosec (config en .golangci.yml)
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Las pruebas de integración y de flujo completo necesitan un PostGIS vacío. Cada paquete crea su
propia base temporal:

```bash
docker run -d --name pawfound-test-db -e POSTGRES_USER=pawfound -e POSTGRES_PASSWORD=pawfound \
  -p 55432:5432 postgis/postgis:16-3.4
TEST_DATABASE_URL="postgres://pawfound:pawfound@localhost:55432/pawfound?sslmode=disable" \
  go test ./... -p 1 -coverpkg=./internal/... -coverprofile=coverage.out
go tool cover -func=coverage.out | tail -1           # el CI exige ≥ 90 %
```

En Windows, si `gofmt -l` o gofumpt marcan archivos que no tocaste, son los finales de línea
CRLF de la copia local: el CI trabaja con LF.

## Estructura

```text
cmd/api/              punto de entrada y subcomandos
internal/config       variables de entorno, con validaciones que impiden arrancar mal configurado
internal/db           pool de pgx y migraciones SQL embebidas (migrations/NNNN_*.sql)
internal/domain       reglas puras, gemelas de apps/mobile/src/domain: límites, insignias, calificaciones,
                      modo descanso, coincidencias, recordatorios y decisión de refugios con el RUES
internal/lifecircle   círculo de vida (vectores compartidos con la app)
internal/geo          ubicación aproximada a 250 m y distancias
internal/auth         Argon2id, JWT, refresh tokens rotativos y códigos de verificación (HMAC)
internal/app          casos de uso sobre PostgreSQL: reportes, alertas, chats, comunidad, PawFamily,
                      privacidad y moderación
internal/httpapi      API REST v1 y middleware (auth, límites, cabeceras de seguridad, registros)
internal/realtime     WebSocket: mensajes, avisos y casos en vivo
internal/media        fotos: re-codificación sin EXIF ni GPS, orientación, hash perceptual; R2 o disco
internal/providers    correo (Brevo o SMTP), push (Expo), RUES (datos.gov.co) y traducción
internal/ratelimit    límites de intentos en la base (con respaldo en memoria)
internal/jobs         tareas periódicas: alertas, coincidencias, recordatorios, PawFamily, refugios y limpieza
internal/admin        panel web de moderación (/admin), sin JavaScript
internal/testdb       base PostGIS aislada para las pruebas de integración
```

## Decisiones

- **SQL explícito con pgx**, sin ORM. Las consultas viven junto a cada caso de uso en `internal/app`.
- **Fotos por la API**: la app sube la foto a `POST /v1/media` y la API la vuelve a codificar antes
  de guardarla. Así nunca se guarda el GPS del celular, aunque la app falle en quitarlo. Se guardan
  en Cloudflare R2 si están sus variables y, si no, en `MEDIA_DIR`.
- **Correo**: por la API web de Brevo (`BREVO_API_KEY`), porque Render gratis bloquea SMTP. También
  sirve cualquier SMTP. En producción, sin proveedor de correo el registro responde
  `provider_unavailable`.
- **Push**: `PUSH_PROVIDER=expo` envía por el servicio push de Expo. Sin proveedor, los avisos quedan
  solo en la bandeja de la app.
- **Refugios**: el RUES se consulta en datos abiertos, sin clave (`RUES_URL`). `RUES_APP_TOKEN` es
  opcional y solo sube el límite de consultas.
- **Una sola instancia**: las tareas periódicas toman un candado de la base, así que dos instancias
  no las repiten. Los límites de negocio (2 reportes por día, 12 mensajes por minuto, 5 alertas por
  día) se cuentan en la base.
- **Sentry** se activa con `SENTRY_DSN` y nunca envía IP, cuerpos de peticiones ni direcciones.
