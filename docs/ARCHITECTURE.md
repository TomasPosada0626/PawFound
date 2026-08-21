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
- **Base de datos**: PostgreSQL con la extensión PostGIS, para modelar ubicación aproximada y resolver búsquedas por radio ("círculo de vida").
- **Acceso a datos**: pgx + sqlc (SQL explícito con generación de código tipado, sin ORM).
- **Autenticación**: correo/contraseña + OAuth (Google, Facebook, Apple) para el login; verificación de identidad por SMS en el registro, que al completarse otorga automáticamente la insignia azul.
- **Geoespacial**: cada mascota reportada tiene una ubicación aproximada y un radio de búsqueda que se expande automáticamente con el tiempo transcurrido desde el último avistamiento (regla exacta pendiente de [definir en producto](https://github.com/TomasPosada0626/PawFound/issues) — épica Producto y descubrimiento).
- **Mensajería**: modelo compartido para DMs y grupos; cada caso (mascota) crea automáticamente su grupo asociado ("Encontremos a [nombre]" / "Encontremos a su familia").
- **Moderación**: reglas descritas en [docs/legal/moderacion-y-ugc.md](legal/moderacion-y-ugc.md) — revisión proporcional al riesgo, no ocultamiento automático solo por volumen de reportes.
- **Alerta Ángel**: envío de SMS geolocalizado a usuarios cercanos cuando se publica un reporte de mascota perdida, con enlace profundo (`https://pawfound.app/alerta/angel/<id>`) al detalle en la app.

## App (Expo / Android)

- **Framework**: Expo (React Native) + TypeScript. Lanzamiento inicial solo para Android; no se asume soporte iOS ni web hasta que se decida explícitamente. Idioma inicial español, inglés como segundo idioma previsto.
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

## Entorno local y CI

- **Entorno local**: Docker Compose (API + PostgreSQL/PostGIS + Redis), sin depender de servicios en la nube para desarrollar.
- **Pruebas y CI**: GitHub Actions.

## Decisiones abiertas

- Regla exacta de expansión del radio del "círculo de vida" (tiempo, avistamientos, o ambos) — [issue #10](https://github.com/TomasPosada0626/PawFound/issues/10).
- Cómo conciliar mostrar una dirección aproximada en el mapa con el detalle de caso, que en el diseño de referencia muestra una dirección textual específica — [issue #46](https://github.com/TomasPosada0626/PawFound/issues/46).
