# PawFound — App móvil

Expo + React Native + TypeScript + NativeWind. Ver [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
en la raíz del repo para el diseño completo y [`Diseño ideal/`](../../Diseño%20ideal/) para
la referencia visual — el mockup manda sobre cualquier otra descripción si hay conflicto.

## Requisitos

- Node.js 20+
- App Expo Go en tu celular Android, o un emulador Android

## Comandos

```bash
npm install
npm run start      # abre el bundler de Expo (escaneá el QR con Expo Go)
npm run android     # abre en un emulador/dispositivo Android conectado
npm run web         # preview en navegador (solo para desarrollo rápido de UI)
```

## Estilos

NativeWind (Tailwind para React Native). Clases utilitarias vía `className`, igual que
Tailwind web — ver `tailwind.config.js` para los tokens de marca (`teal`, `navy`).

## Estado

Solo la pantalla placeholder de `App.tsx`. Las pantallas reales se construyen issue por
issue según la épica [Experiencia móvil](https://github.com/TomasPosada0626/PawFound/issues/3),
una vez resuelto el diseño de flujo correspondiente.

## Vulnerabilidades conocidas (aceptadas, no de runtime)

`npm audit` reporta 15 vulnerabilidades heredadas de Metro/Expo CLI (parsers de imagen
ICNS/JXL/HEIF con DoS, y `uuid` vía `xcode`/`@expo/config-plugins`). Son de las
herramientas de build (Metro, Expo CLI), no de código que corre en el dispositivo de la
persona usuaria, y el único fix disponible (`npm audit fix --force`) baja a
`expo@53.0.27` — una regresión mayor de SDK. Quedan aceptadas y trackeadas para que
Renovate (`renovate.json` en la raíz) las resuelva cuando Expo publique una versión de la
cadena Metro sin este problema, en vez de forzar un downgrade ahora.

## Pendiente antes de la primera build real

- Reemplazar los íconos de `assets/` (generados por el template de Expo) por el logo real
  de PawFound (`../../assets/brand/logo.png`).
- Generar el cliente TypeScript desde [`packages/contracts/openapi.yaml`](../../packages/contracts) en cuanto la API tenga más de un endpoint.
