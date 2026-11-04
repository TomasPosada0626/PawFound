# Capturas de la app

Capturas reales de la app que usa el [README](../../README.md) principal. Se toman en **modo
demostración**, para que no aparezcan datos de personas reales: las personas, los casos y los chats
son de ejemplo (`apps/mobile/src/services/seed.ts`) y las fotos son de
[Unsplash](https://unsplash.com/license).

| Archivo | Pantalla |
| --- | --- |
| `inicio.webp` | Inicio con la cuenta de ejemplo |
| `mapa.webp` | Mapa (sin compartir ubicación, para ver todos los casos) |
| `caso.webp` | Caso de Max con su círculo de vida (`/pet/max`) |
| `reportar.webp` | Formulario de reporte (`/report`) |
| `alerta-angel.webp` | Alerta Ángel de Max (`/alerta/angel/max`) |
| `chat-del-caso.webp` | Grupo «Encontremos a Toby» (`/chat/grp_toby`) |
| `perfil.webp` | Perfil, arriba |
| `insignias.webp` | Perfil, sección de insignias y «Mis mascotas» |
| `pawfamily.webp` | PawFamily como persona natural |

## Regenerarlas

Cuando cambie el diseño de alguna de esas pantallas:

1. Exporta la app para web sin API, para que corra en modo demostración:

   ```bash
   cd apps/mobile
   EXPO_PUBLIC_API_URL= npx expo export --platform web --output-dir /tmp/pawfound-web
   ```

2. Sirve esa carpeta con cualquier servidor estático que devuelva `index.html` en las rutas
   desconocidas (por ejemplo `npx serve -s /tmp/pawfound-web`).
3. Ábrela en el navegador con el modo de dispositivo a **412 × 892** y escala 2, en modo claro y
   con la ubicación en Medellín (6.2442, −75.5812).
4. Entra con `demo@pawfound.app` / `PawFound2026` y captura cada pantalla de la tabla.
5. Guárdalas en WebP (calidad cercana a 80) con el mismo nombre.

En la versión web el mapa usa mosaicos de OpenStreetMap; en Android es Google Maps. Evita capturar
funciones que en producción no están activas, como la traducción de mensajes del grupo de Max.
