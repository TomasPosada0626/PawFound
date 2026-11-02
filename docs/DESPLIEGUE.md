# Despliegue sin costos

Cómo publicar PawFound para el piloto usando solo capas gratuitas. Cada proveedor guarda o
procesa datos personales: antes de activarlo en producción completa su evaluación de
privacidad ([docs/legal/incidentes-y-proveedores.md](legal/incidentes-y-proveedores.md)). Las
condiciones de los planes gratuitos cambian: confírmalas al crear cada cuenta.

| Pieza | Servicio gratuito | Qué guarda |
| --- | --- | --- |
| Sitio web (`apps/web`) | Cloudflare Pages | Nada personal (HTML estático) |
| Base de datos | Neon (PostgreSQL con PostGIS) | Cuentas, reportes, chats |
| API (`apps/api`) | Render (plan gratis) u Oracle Cloud Always Free | Nada en disco |
| Fotos | Cloudflare R2 | Fotos sin EXIF ni GPS |
| Correo (códigos) | Brevo (SMTP) | Correo de destino y el mensaje |
| Notificaciones push | Servicio push de Expo (EAS) | Token del celular y el aviso |
| Compilar la app | EAS Build | El código de la app |

## 1. Sitio web: Cloudflare Pages

1. En Cloudflare, *Workers & Pages* → *Create* → *Pages* → conectar el repositorio de GitHub.
2. Directorio raíz `apps/web`, comando `npm run build`, carpeta de salida `dist`.
3. Variable `SITE_URL` con la dirección que te asigne, por ejemplo `https://pawfound.pages.dev`.

Sin dominio propio, esa dirección es la del proyecto. Cuando la tengas, actualiza:
`EXPO_PUBLIC_WEB_URL` (app), `PUBLIC_WEB_URL` (API) y los `intentFilters` y
`associatedDomains` de `apps/mobile/app.json`.

## 2. Base de datos: Neon

1. Crea un proyecto en neon.tech (región más cercana a Colombia).
2. Copia la cadena de conexión en `DATABASE_URL` (con `sslmode=require`).
3. La API aplica las migraciones con `api migrate` (incluyen `CREATE EXTENSION postgis`).

## 3. API

La imagen se construye con `apps/api/Dockerfile`.

- **Render (más simple)**: *New Web Service* desde el repositorio, rama `main`, entorno
  *Docker*, directorio `apps/api`, *Health Check Path* `/ready`. El plan gratuito se duerme tras
  15 minutos sin tráfico: mientras duerme no corren las tareas periódicas (el círculo de vida
  que alcanza a más celulares) y la primera petición tarda cerca de un minuto. Además, **bloquea
  el correo por SMTP** (puertos 465 y 587, desde septiembre de 2025): por eso el correo sale por
  la API web de Brevo (`BREVO_API_KEY`). Tampoco tiene pestaña *Shell*: los comandos de inicio se
  corren desde un computador (ver abajo). Sirve para el piloto.
- **Oracle Cloud Always Free (siempre encendida)**: una máquina virtual gratuita donde corre el
  mismo contenedor con `docker run`. Requiere más configuración y verificar identidad con una
  tarjeta, sin cobro dentro del plan gratuito.

Variables mínimas (ver `infra/.env.example`):

```bash
APP_ENV=production
DATABASE_URL=...                      # Neon
JWT_SECRET=...                        # openssl rand -base64 48
PUBLIC_API_URL=https://<tu-api>       # https obligatorio
PUBLIC_WEB_URL=https://pawfound.pages.dev
MIGRATE_ON_START=true
CLIENT_IP_HEADER=CF-Connecting-IP     # Render está detrás de Cloudflare: IP real para el antiabuso
BREVO_API_KEY=<clave de API v3 de Brevo>
SMTP_FROM=<correo remitente verificado en Brevo>
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_BUCKET=pawfound-fotos
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
PUSH_PROVIDER=expo
```

Después del primer arranque no hace falta correr nada: si la tabla de veterinarias está vacía,
la API las importa sola de OpenStreetMap, y las cuentas de `ADMIN_EMAILS` reciben el rol de
administrador en cuanto verifican su correo (agrega `ADMIN_EMAILS=tu-correo@ejemplo.com`).

Para volver a importarlas o dar otros roles, desde un computador con el repositorio y la
cadena de Neon:

```powershell
cd apps/api
$env:APP_ENV="development"
$env:JWT_SECRET="solo-para-comandos-locales-0123456789abcdef"
$env:DATABASE_URL="<cadena de Neon>"
go run ./cmd/api import-places                              # veterinarias (OpenStreetMap)
go run ./cmd/api grant-role tu-correo@ejemplo.com admin     # acceso al panel /admin
```

## 4. Fotos: Cloudflare R2

En Cloudflare, *R2* → crear el bucket `pawfound-fotos` (privado) → *Manage API tokens* → token
con permiso de lectura y escritura solo para ese bucket. La API sirve las fotos (las de chat
solo a los miembros del chat), así que el bucket nunca se hace público. Cloudflare puede pedir
registrar un medio de pago para activar R2 aunque no cobre dentro del plan gratuito.

## 5. Correo: Brevo

1. Crea la cuenta en brevo.com.
2. *Senders* → agrega y verifica el correo remitente (por ejemplo un Gmail del proyecto). Sin
   dominio propio, Brevo advierte que un correo gratuito llega más a spam: se acepta igual.
3. *SMTP & API* → pestaña **API Keys** → genera una clave de API: es `BREVO_API_KEY`. La clave
   SMTP (`SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`) solo sirve en hostings que permiten SMTP.
4. Si Brevo rechaza los envíos por "IP no autorizada", en *Security* → *Authorised IPs* desactiva
   el bloqueo de IP desconocidas: Render no tiene una IP fija.

Sin dominio propio los correos pueden caer en spam con más facilidad; la app avisa que se
revise esa carpeta. Con dominio, se agregan los registros SPF y DKIM que indica Brevo.

## 6. App: EAS

```bash
cd apps/mobile
npx eas-cli login          # con tu cuenta de expo.dev (la escribes tú)
npx eas-cli init           # crea el proyecto y guarda el projectId en app.json
EXPO_PUBLIC_API_URL=https://<tu-api> EXPO_PUBLIC_WEB_URL=https://pawfound.pages.dev \
  npx eas-cli build -p android --profile preview   # APK para probar en celulares
```

La API key de Google Maps va en `app.json` → `android.config.googleMaps.apiKey` antes del build.

### Actualizaciones sin reinstalar (EAS Update)

La app instalada busca actualizaciones al abrirse (`expo-updates`, canal `preview` o
`production` según el build). Los cambios de pantallas, textos y colores se publican sin
compilar ni reinstalar:

```bash
cd apps/mobile
npx eas-cli update --channel preview --environment preview --message "qué cambió"
```

Si la actualización llega en los primeros segundos, la app se reinicia con ella; si no, la usa
la próxima vez que se abra. Los cambios nativos (permisos, librerías nuevas, ícono) cambian la
huella (`runtimeVersion` por *fingerprint*) y necesitan un build nuevo: las actualizaciones
nunca llegan a una app con una huella distinta.

## 7. Mantener la API despierta

El plan gratuito de Render duerme la API tras 15 minutos sin tráfico: la primera petición tarda de
10 a 60 segundos y las tareas periódicas se detienen. El cron de GitHub Actions no alcanza, porque
en la práctica corre cada varias horas. Por eso un servicio externo visita la API:

1. En [cron-job.org](https://cron-job.org), crear un trabajo con la URL
   `https://pawfound-api.onrender.com/health`.
2. Programarlo cada 5 minutos, todo el día.

`/health` no consulta la base de datos. Las tareas periódicas corren cada 10 minutos solo si hubo
un reporte o un movimiento reciente, y cada hora si no, para no gastar la cuota de Neon. Con
presupuesto, el plan pago de Render evita todo esto y da más CPU.

## 8. Monitoreo de errores (opcional)

Con una cuenta en [Sentry](https://sentry.io), definir `SENTRY_DSN` en Render y
`EXPO_PUBLIC_SENTRY_DSN` en EAS. Sin esas variables no se envía nada. Nunca salen datos personales:
ni IP, ni cuerpos de peticiones, ni direcciones.

## 9. Enlaces directos a la app

`apps/web/public/.well-known/assetlinks.json` lleva la huella SHA-256 del certificado con el que se
firma la app. Al publicar en Google Play con firma de aplicaciones, hay que **agregar** la huella que
muestra Play Console; si no, los enlaces no abren la app instalada desde la tienda.

## 10. Respaldos

Cada día, `.github/workflows/respaldo.yml` guarda una copia **cifrada** de la base en un bucket
privado de Cloudflare R2 y borra las de más de 30 días. Sin los secretos configurados, avisa y no
hace nada. Las copias nunca van en artefactos de GitHub Actions: el repositorio es público.

Para activarlo:

1. En Cloudflare R2, crear un bucket privado `pawfound-respaldos` y un token con permiso de lectura
   y escritura solo para ese bucket.
2. En GitHub → Settings → Secrets and variables → Actions, crear:
   `RESPALDO_DATABASE_URL` (cadena de conexión de Neon), `RESPALDO_CLAVE` (una clave larga),
   `RESPALDO_R2_ACCOUNT_ID`, `RESPALDO_R2_BUCKET`, `RESPALDO_R2_ACCESS_KEY_ID` y
   `RESPALDO_R2_SECRET_ACCESS_KEY`.
3. Guardar `RESPALDO_CLAVE` también fuera de GitHub: **sin ella los respaldos no se pueden abrir**.
4. Correr el trabajo a mano desde la pestaña Actions y confirmar que aparece el archivo.

Para restaurar, en una base **vacía** con PostGIS activado (el script se niega si ya tiene tablas):

```sh
DATABASE_URL=postgres://... RESPALDO_CLAVE=... scripts/restaurar.sh pawfound-AAAA-MM-DD.dump.gpg
```

Las fotos no van en el respaldo: viven en R2. Neon también permite restaurar la base a un momento
anterior dentro del plazo de su plan; confirmar ese plazo en su panel.
