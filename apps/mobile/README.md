# PawFound — App móvil

Expo SDK 57 + React Native + TypeScript + NativeWind + expo-router. Ver
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) para el diseño completo y
[`Diseño ideal/`](../../Diseño%20ideal/) para la referencia visual: el mockup manda sobre
cualquier otra descripción si hay conflicto.

## Requisitos

- Node.js 20+
- App Expo Go en un Android, o un emulador Android

## Comandos

```bash
npm install
npm run start          # bundler de Expo (escanea el QR con Expo Go)
npm run android        # emulador/dispositivo Android conectado
npm run web            # vista previa en navegador (solo desarrollo de UI; el mapa es esquemático)
npm run typecheck      # TypeScript estricto
npm run lint           # ESLint (config de Expo)
npm test               # unitarias + flujos completos
npm run test:coverage  # con cobertura (umbral ≥ 80 % en package.json)
```

## Modo demostración

Mientras la API no exponga los endpoints de dominio, la app corre contra un backend
simulado en memoria (`src/services/mockBackend.ts`) que aplica las mismas reglas que la
API: límite de 2 reportes por día, verificación SMS con bloqueo tras 5 intentos,
ubicación aproximada a celdas de 250 m, grupos de caso automáticos y permisos. Los datos
de ejemplo (`src/services/seed.ts`) no son casos reales y se reinician al cerrar la app.

- Cuenta de demostración: `demo@pawfound.app` / `PawFound2026` (botón en el login).
- Código SMS de demostración: `123456`.

Para conectar la API real, reemplazar `MockBackend` por un cliente generado desde
[`packages/contracts/openapi.yaml`](../../packages/contracts) que implemente los mismos
métodos; las pantallas solo dependen de `useBackend()` / `useBackendState()`.

## Estructura

```text
app/                    # rutas (expo-router): (tabs), pet/[id], report, chat/[id], auth, settings
src/domain/             # reglas puras: círculo de vida, geo/privacidad, validación, coincidencias
src/services/           # backend simulado, seed, selectores, almacenamiento local
src/store/              # providers: backend, preferencias del dispositivo, ubicación
src/i18n/               # es (fuente) + en; TypeScript exige las mismas claves en ambos
src/theme/              # tokens de color (claro/oscuro, contraste verificado) y tema
src/components/         # UI: kit base, mapa, pines, círculo de vida, insignias, layouts
__tests__/              # flujos completos sobre el router real
```

## Decisiones de producto implementadas

- **Modo exploración**: mapa, inicio y detalle sin cuenta; reportar, escribir o unirse a
  un grupo pide cuenta con celular verificado (`useAuthGate`).
- **Círculo de vida** por perfil (issue #10), con vista previa de crecimiento (+6/+24/+72 h)
  y capa opcional en el mapa. La fórmula se valida contra
  `packages/contracts/fixtures/life-circle.json`, el mismo archivo que usa la API en Go.
- **Privacidad**: nunca se muestra la dirección exacta (issue #46); nombre corto del
  autor; consentimiento propio antes del permiso de ubicación del sistema.
- **Traducción de chats**: cada mensaje guarda su idioma; quien lee en otro idioma ve la
  traducción generada por el servidor, con "Ver original". En demo no hay proveedor y no
  se inventan traducciones de mensajes nuevos.
- **Alerta Ángel por push** (no SMS): llega a los celulares dentro del círculo de vida y a
  más celulares a medida que crece (`src/domain/alerts.ts`, `BackgroundServices`). En demo
  son notificaciones locales (funcionan en Expo Go); en producción las envía la API.
- **Insignias por niveles** (`src/domain/badges.ts`), celebración al ganarlas y "Ángel de
  patas" que la familia otorga al cerrar el caso.
- **Perfiles públicos con "me gusta"** (`app/user/[id].tsx`), días en PawFound, y
  convivencia sin bloqueos: reportar persona, aviso amable y límite de mensajes.
- **Mis mascotas** (perfil preventivo → reporte con un toque), **afiche con QR** e
  **historia para Instagram** (`app/pet/[id]/story.tsx`, con guía para Destacadas).
- **Fotos en el chat** (grupos y DM) y **"¿Es tu mascota?"** (`src/domain/matching.ts`,
  vectores compartidos con la API en `packages/contracts/fixtures/owned-matches.json`).
- **Accesibilidad** (docs/accesibilidad.md): touch targets ≥ 48 dp, labels reales,
  regiones vivas para errores, estado nunca solo por color, contraste AA probado en tests.

## Mapa en builds propios

`react-native-maps` usa Google Maps en Android. En Expo Go funciona sin configuración;
para un build de EAS hay que agregar la API key en `app.json` →
`android.config.googleMaps.apiKey` (restringida al paquete `app.pawfound`).

## Pruebas en dispositivo (e2e)

Las pruebas de `__tests__/` recorren los flujos sobre el router real con módulos nativos
simulados. Falta la capa en dispositivo (Maestro o Detox, docs/ARCHITECTURE.md), que
requiere un emulador en CI.

## Vulnerabilidades conocidas (aceptadas, no de runtime)

`npm audit --omit=dev` reporta avisos "high" en `@expo/cli`, `zod` e `image-size`. Son de la
cadena de build de Expo (no corren en el dispositivo) y su única corrección es un cambio
mayor de SDK. CI bloquea cualquier aviso crítico; los demás los resuelve Renovate al salir
la versión corregida de Expo.

## Pendiente antes de la primera build real

- Reemplazar los íconos de `assets/` por el isotipo real de PawFound.
- Avatares ilustrados definitivos (hoy son avatares de animales con emoji, issue #61).
- Proveedor de traducción, SMS y almacenamiento de fotos, cada uno tras su evaluación en
  `docs/legal/incidentes-y-proveedores.md`.

## Conectar con la API real

Sin configuración la app corre en **modo demostración** (todo en memoria). Para usar la API:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:8080 npx expo start   # la IP de tu computador en la red local
```

`src/services/apiBackend.ts` implementa la misma interfaz que el backend de demostración, así
que las pantallas no cambian. La ubicación en segundo plano para las Alertas Ángel necesita
un build propio (EAS o `expo run:android`): en Expo Go solo se actualiza con la app abierta.
