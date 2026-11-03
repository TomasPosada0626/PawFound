# PawFound — App móvil

Expo SDK 57 + React Native + TypeScript + NativeWind + expo-router, Android primero (iOS después,
con el mismo código). Diseño completo en [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md),
reglas de producto en [PRODUCT.md](../../PRODUCT.md) y referencia visual en
[`Diseño ideal/`](../../Diseño%20ideal/).

## Requisitos

- Node.js 20 o más nuevo (el CI usa 20).
- Un Android con el APK de PawFound, un emulador o Expo Go para SDK 57. El Expo Go de la Play
  Store puede ser de otro SDK: descarga el 57 en [expo.dev/go](https://expo.dev/go). En Expo Go el
  mapa de Google sale en blanco sin clave propia.

## Comandos

```bash
npm install
npm run start          # bundler de Expo
npm run android        # emulador o dispositivo Android conectado
npm run web            # vista previa en el navegador (solo para la interfaz; el mapa es esquemático)
npm run typecheck      # TypeScript estricto
npm run lint           # ESLint
npx prettier --check "app/**/*.{ts,tsx}" "src/**/*.{ts,tsx}" "__tests__/**/*.tsx"
npm test               # unitarias y flujos completos
npm run test:coverage  # con cobertura: el CI exige ≥ 80 % de líneas y sentencias (package.json)
```

## Modo demostración o API real

La app elige el backend con `EXPO_PUBLIC_API_URL`:

- **Sin la variable**: modo demostración en memoria (`src/services/mockBackend.ts`). Aplica las
  mismas reglas que la API: 2 reportes por día, verificación de correo con bloqueo tras 5
  intentos, ubicación aproximada a 250 m, grupos de caso y permisos. Los datos de ejemplo
  (`src/services/seed.ts`) no son casos reales y se reinician al cerrar la app.
  - Cuenta de demostración: `demo@pawfound.app` / `PawFound2026` (botón en el login).
  - Código de verificación de demostración: `123456`.
- **Con la variable**: `src/services/apiBackend.ts` habla con la API. Implementa la misma interfaz
  (`Backend`), así que las pantallas no cambian. Para la API local:

  ```bash
  EXPO_PUBLIC_API_URL=http://192.168.1.10:8080 npx expo start   # la IP de tu computador en la red local
  ```

El cliente de la API está escrito a mano. Cuando cambia una ruta, sus tipos
(`src/domain/types.ts`, `src/services/backendTypes.ts`) y el contrato
[`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml) se actualizan en el mismo
PR. Un código de error nuevo de la API debe agregarse a `ErrorCode` y a `KNOWN_CODES`; si no, la app
lo muestra como error genérico.

## Variables

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | EAS (y `.env` local) | URL de la API. Sin ella, modo demostración. Los builds de EAS fallan si falta |
| `EXPO_PUBLIC_WEB_URL` | EAS | Sitio de los enlaces compartidos (`https://pawfound.pages.dev`) |
| `GOOGLE_MAPS_API_KEY` | EAS (y `.env` local, ignorado por git) | Clave de Google Maps para Android, restringida al paquete `app.pawfound`. `app.config.js` la inyecta; nunca va en `app.json` porque el repositorio es público |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS | Opcional: activa el reporte de errores. Hoy no está configurada |

## Builds y actualizaciones

```bash
npx eas-cli build -p android --profile preview      # APK para instalar en celulares
npx eas-cli update --channel preview --environment preview --platform android --message "qué cambió"
```

Los cambios de JavaScript (pantallas, textos, reglas) llegan por EAS Update sin reinstalar. Los
nativos (librerías nuevas, permisos, ícono) cambian la huella (`runtimeVersion` por *fingerprint*) y
piden un APK nuevo. Antes de publicar una actualización, confirma que la huella coincide con la del
APK instalado ([docs/DESPLIEGUE.md § 6](../../docs/DESPLIEGUE.md#6-app-eas)).

## Estructura

```text
app/                    rutas (expo-router): (tabs), pet/[id], report, chat/[id], auth, settings,
                        pawfamily, user/[id], my-pets, alerta, historias, veterinarias, seguidores
src/domain/             reglas puras: círculo de vida, alertas, coincidencias, insignias,
                        calificaciones, validación, NIT, geo y privacidad
src/services/           ApiBackend, MockBackend, seed, selectores, almacenamiento local
src/store/              providers: backend, preferencias del dispositivo, ubicación
src/features/           lógica compartida entre pantallas (mensajes de error, etc.)
src/hooks/              hooks (useAuthGate y otros)
src/i18n/               es (fuente) + en; TypeScript exige las mismas claves en ambos
src/theme/              tokens de color (claro y oscuro, contraste verificado) y tema
src/components/         UI: kit base, mapa, pines, círculo de vida, insignias, avatares, PawFamily
__tests__/              flujos completos sobre el router real
```

## Decisiones implementadas

- **Modo exploración**: inicio, mapa y detalle sin cuenta. Reportar, escribir, unirse a un grupo o
  actuar en PawFamily pide una cuenta con correo verificado (`useAuthGate`).
- **Círculo de vida** (issue #10): se valida contra `packages/contracts/fixtures/life-circle.json`,
  el mismo archivo que usa la API.
- **Privacidad**: nunca se muestra la dirección exacta (issue #46), el autor aparece con nombre
  corto y la app explica el uso de la ubicación antes del permiso del sistema.
- **Alerta Ángel por push**: con la ubicación en segundo plano (`BackgroundServices`, tarea de
  `expo-location`) el servidor sabe el último punto aproximado. En modo demostración son
  notificaciones locales. La ubicación en segundo plano necesita un build propio: en Expo Go solo
  se actualiza con la app abierta.
- **Insignias** (`src/domain/badges.ts`, `src/components/badges.tsx`): medallas por niveles con
  celebración al ganarlas.
- **Calificaciones** (`src/components/RatingSummary.tsx`): el promedio solo se ve desde la décima.
- **Avatares ilustrados** (`src/components/avatars.tsx`) o foto de perfil propia.
- **PawFamily** (`app/pawfamily/`): búsqueda con filtros, publicación, solicitudes, seguimiento y
  verificación de refugios con mensajes claros para cada rechazo del RUES.
- **Eliminar la cuenta** (`src/components/DeleteAccountSheet.tsx`): pide escribir ELIMINAR y borra
  también lo guardado en el celular.
- **Accesibilidad** ([docs/accesibilidad.md](../../docs/accesibilidad.md)): touch targets ≥ 48 dp,
  etiquetas reales, regiones vivas para errores, estado nunca solo por color y contraste AA
  probado en tests.

## Pruebas en dispositivo

Las pruebas de `__tests__/` recorren los flujos sobre el router real con módulos nativos simulados.
Falta la capa en dispositivo (Maestro o Detox), que necesita un emulador en el CI.

## Vulnerabilidades conocidas

`npm audit --omit=dev` puede reportar avisos «high» en la cadena de build de Expo (`@expo/cli` y sus
dependencias). No corren en el celular y su corrección suele llegar con un SDK nuevo. El CI bloquea
cualquier aviso crítico; Renovate actualiza el resto cuando sale la versión corregida.
