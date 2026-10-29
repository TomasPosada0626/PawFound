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

- **Render (más simple)**: *New Web Service* desde el repositorio, entorno *Docker*, directorio
  `apps/api`. El plan gratuito se duerme tras un rato sin tráfico: mientras duerme no corren
  las tareas periódicas (el círculo de vida que alcanza a más celulares) y la primera petición
  tarda en despertar. Sirve para el piloto.
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
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USERNAME=<usuario SMTP de Brevo>
SMTP_PASSWORD=<clave SMTP de Brevo>
SMTP_FROM=<correo remitente verificado en Brevo>
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_BUCKET=pawfound-fotos
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
PUSH_PROVIDER=expo
```

Después del primer arranque:

```bash
api import-places                              # veterinarias (OpenStreetMap)
api grant-role tu-correo@ejemplo.com admin     # acceso al panel /admin
```

## 4. Fotos: Cloudflare R2

En Cloudflare, *R2* → crear el bucket `pawfound-fotos` (privado) → *Manage API tokens* → token
con permiso de lectura y escritura solo para ese bucket. La API sirve las fotos (las de chat
solo a los miembros del chat), así que el bucket nunca se hace público. Cloudflare puede pedir
registrar un medio de pago para activar R2 aunque no cobre dentro del plan gratuito.

## 5. Correo: Brevo

1. Crea la cuenta en brevo.com.
2. *Senders* → agrega y verifica el correo remitente (por ejemplo un Gmail del proyecto).
3. *SMTP & API* → genera una clave SMTP: es `SMTP_PASSWORD`; el usuario SMTP es `SMTP_USERNAME`.

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
Para "Continuar con Google" se crean los ID de cliente en Google Cloud Console (pantalla de
consentimiento + ID de Android con el nombre del paquete y la huella SHA-1 del build) y se
ponen en `GOOGLE_CLIENT_IDS` (API).
