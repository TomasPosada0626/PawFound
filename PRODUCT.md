# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Stack

Backend: API en Go (router Chi + contrato OpenAPI), PostgreSQL con PostGIS (búsqueda geoespacial), acceso a datos con pgx + sqlc, WebSockets para mensajería en tiempo real. App: Expo (React Native) + TypeScript, lanzamiento inicial solo Android (Fase 4 de la hoja de ruta); idioma inicial español, inglés como segundo idioma previsto. Entorno local con Docker Compose; CI con GitHub Actions. Proveedores previstos (por evaluar en `docs/legal/incidentes-y-proveedores.md`): Cloudflare R2 (imágenes, sin EXIF), Firebase Cloud Messaging (notificaciones push Android), Upstash Redis (caché y rate limiting), Sentry (errores). Decisión ya registrada en `docs/PROJECT_MANAGEMENT.md` y en la wiki, no delegada a impeccable.

## Users

Comunidad general en Colombia: cualquier persona (dueño/a de una mascota perdida, o vecino/a que encuentra una mascota) que necesita reportar o buscar por zona. Refugios, rescatistas y voluntariado participan como validadores durante el MVP (Fase 1), no como un tipo de cuenta con permisos propios dentro de la app.

## Product Purpose

Reducir el tiempo entre la pérdida de una mascota y su reencuentro seguro con su familia, mediante reportes claros, búsqueda geolocalizada por zona y coordinación responsable de la comunidad. Éxito = mascotas reencontradas y comunicación segura entre quien perdió y quien encontró, sin exponer datos sensibles.

## Positioning

A diferencia de publicar en un grupo genérico de Facebook/vecinos, PawFound estructura todo el ciclo de un caso: cuentas verificadas por SMS (insignia azul automática al verificar), un "círculo de vida" por mascota que amplía automáticamente su radio de búsqueda con el tiempo en vez de un pin estático, y un grupo de chat dedicado que se crea solo por caso ("Encontremos a [nombre]" en rojo para perdidas, "Encontremos a su familia" en azul para encontradas) en lugar de mezclar todos los reportes en un solo hilo.

## Operating Context

- **Mapa**: muestra todas las mascotas reportadas (perdidas y encontradas) como pines.
- **Detalle de mascota**: se llega desde un pin del mapa o desde la lista de reportes debajo del mapa; muestra el "círculo de vida", el radio de búsqueda que se expande automáticamente con el tiempo.
- **Reportar (botón +)**: reportar mascota perdida o mascota encontrada.
- **Chats**, con tres secciones: DMs (conversación directa con otro usuario), Grupos (a los que el usuario se unió) y Notificaciones (todos los reportes de mascotas perdidas/encontradas cercanos + actualizaciones de casos).
- **Grupos automáticos por caso**: nombre fijo "Encontremos a [Nombre del perrito]" para mascotas perdidas (tema rojo); "Encontremos a su familia" para mascotas encontradas (tema azul).
- **Perfil**: editar perfil, notificaciones, privacidad y seguridad, soporte y ayuda.
- Modo claro/oscuro conmutable desde el login.

## Capabilities and Constraints

- Login: correo/contraseña + continuar con Google, Facebook o Apple (confirmado en `Diseño ideal/login.png`).
- Registro: verificación de cuenta por SMS al número registrado; al verificarse, la cuenta recibe automáticamente la insignia azul de verificado. No hay un paso de aprobación manual descrito.
- No se muestran direcciones ni coordenadas exactas de forma predeterminada (regla ya fijada en `docs/legal/tratamiento-de-datos.md`); el mapa trabaja con ubicación aproximada.
- El radio de búsqueda ("círculo de vida") se actualiza/amplía automáticamente; el mecanismo exacto de expansión (tiempo transcurrido, ausencia de avistamientos, etc.) queda como decisión abierta de producto, no inventar la regla.
- Notificaciones de la app son avisos de la comunidad, explícitamente no alertas gubernamentales ni SMS (aclarado en `docs/legal/consentimientos.md`).
- Publicación y su chat de caso se archivan al marcar la mascota como encontrada; no se eliminan automáticamente.

## Brand Commitments

Nombre: **PawFound**, isotipo de pin con silueta de perro/gato dentro de una huella, en gradiente verde azulado (teal) sobre azul marino oscuro para el wordmark. Tagline: "Conectamos patas, reunimos familias". Soporta modo claro y modo oscuro. Principios ya declarados en README: bienestar y seguridad animal primero; información verificable y comunicación respetuosa; protección de datos personales y de ubicación; colaboración abierta y trazable.

## Evidence on Hand

- 16 pantallas de referencia visual en `Diseño ideal/` (nombres literales de archivo, en español): `login.png`, `Registro.png`, `Home.png`, `Mapa.png`, `Mascota especifica.png`, `Reporte perdida.png`, `Reporte encontrada.png`, `Chats DM.png`, `Chats Grupos.png`, `Chatss notificaciones.png`, `Pefil.png`, `Editar perfil.png`, `Notificaciones.png`, `Privacidad y seguridad.png`, `Soporte y ayuda.png`, `Alerta Angel.png`. El usuario las confirmó como la referencia de cómo quiere que se vean las pantallas ("las vistas como quiero que sean").
- `docs/PROJECT_MANAGEMENT.md`: hoja de ruta, backlog y stack ya decididos.
- `docs/legal/*.md`: borradores técnicos (tratamiento de datos, consentimientos, moderación/UGC, incidentes y proveedores), enfocados en Colombia, pendientes de revisión legal.
- No hay evidencia de usuarios reales, testimonios, casos de estudio ni métricas todavía; no inventar ninguno.

## Product Principles

1. Bienestar y seguridad animal primero, por encima de la conveniencia de producto.
2. Verificación real (SMS) antes que confianza implícita; la insignia azul significa identidad verificada, no reputación.
3. Minimizar exposición de datos sensibles por defecto (ubicación aproximada, no exacta).
4. Cada caso (mascota) es una unidad de coordinación propia: su propio grupo, su propio radio de búsqueda, su propio hilo.
5. Herramienta comunitaria gratuita; sin publicidad ni fricción de pago en el flujo de ayuda.

## Accessibility & Inclusion

Sin requisito de accesibilidad específico confirmado todavía; no se ha establecido un estándar objetivo (p. ej. WCAG) para la app Android. Tratar como abierto, no asumir cumplimiento.
