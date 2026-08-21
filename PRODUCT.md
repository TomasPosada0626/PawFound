# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Stack

Backend: API en Go (router Chi + contrato OpenAPI), PostgreSQL con PostGIS (búsqueda geoespacial), acceso a datos con pgx + sqlc, WebSockets para mensajería en tiempo real. App: Expo (React Native) + TypeScript, lanzamiento inicial solo Android (Fase 4 de la hoja de ruta); idioma inicial español, inglés como segundo idioma previsto. Entorno local con Docker Compose; CI con GitHub Actions. Proveedores previstos (por evaluar en `docs/legal/incidentes-y-proveedores.md`): Cloudflare R2 (imágenes, sin EXIF), Firebase Cloud Messaging (notificaciones push Android), Upstash Redis (caché y rate limiting), Sentry (errores). Decisión ya registrada en `docs/PROJECT_MANAGEMENT.md` y en la wiki, no delegada a impeccable.

## Users

Comunidad general en Colombia: cualquier persona (dueño/a de una mascota perdida, o vecino/a que encuentra una mascota) que necesita reportar o buscar por zona. Refugios, rescatistas y voluntariado participan como validadores durante el MVP (Fase 1), no como un tipo de cuenta con permisos propios dentro de la app.

Señal real de investigación (issues #7/#8, 6 entrevistas): veterinarias y un refugio
mostraron interés concreto en un rol de cuenta institucional para publicar una vez y
llegar a más gente. Muestra chica, no concluyente — no cambia el modelo de arriba todavía;
ver [issue #63](https://github.com/TomasPosada0626/PawFound/issues/63) antes de asumir
que esto ya está decidido.

## Product Purpose

Reducir el tiempo entre la pérdida de una mascota y su reencuentro seguro con su familia, mediante reportes claros, búsqueda geolocalizada por zona y coordinación responsable de la comunidad. Éxito = mascotas reencontradas y comunicación segura entre quien perdió y quien encontró, sin exponer datos sensibles.

## Métricas de éxito (MVP)

Resuelto (issue #9). Métrica principal: **% de casos "perdida" marcados como "encontrada"
dentro de 14 días** desde el reporte (tasa de reencuentro). Ninguna métrica requiere
exponer ubicación exacta ni datos personales.

Secundarias:

- Tiempo mediano entre reporte y marcado como encontrada.
- Tasa de activación: % de cuentas nuevas que verifican por SMS y completan un reporte o
  se unen a un grupo de caso dentro de los primeros 7 días.
- Reportes de abuso/moderación por cada 1000 casos publicados.
- Tiempo mediano de respuesta a una acción de moderación.
- Tasa de apertura del enlace de Alerta Ángel (proxy de utilidad, vigilar que no baje por
  fatiga de notificaciones).

## Positioning

A diferencia de publicar en un grupo genérico de Facebook/vecinos, PawFound estructura todo el ciclo de un caso: cuentas verificadas por SMS (insignia azul automática al verificar), un "círculo de vida" por mascota que amplía automáticamente su radio de búsqueda con el tiempo en vez de un pin estático, y un grupo de chat dedicado que se crea solo por caso ("Encontremos a [nombre]" en rojo para perdidas, "Encontremos a su familia" en azul para encontradas) en lugar de mezclar todos los reportes en un solo hilo.

## Operating Context

- **Modo exploración**: el mapa y el feed son visibles sin cuenta, en solo lectura — crear
  cuenta se pide recién al intentar reportar, contactar por chat o unirse a un grupo de
  caso. Decidido en la crítica de diseño del flujo de login/registro (issue #11), para no
  forzar una cuenta antes de que alguien en una emergencia pueda ver qué hay cerca.
- **Mapa**: muestra todas las mascotas reportadas (perdidas y encontradas) como pines.
- **Detalle de mascota**: se llega desde un pin del mapa o desde la lista de reportes debajo del mapa; muestra el "círculo de vida", el radio de búsqueda que se expande automáticamente con el tiempo.
- **Reportar (botón +)**: reportar mascota perdida o mascota encontrada.
- **Chats**, con tres secciones: DMs (conversación directa con otro usuario), Grupos (a los que el usuario se unió) y Notificaciones (todos los reportes de mascotas perdidas/encontradas cercanos + actualizaciones de casos).
- **Grupos automáticos por caso**: nombre fijo "Encontremos a [Nombre del perrito]" para mascotas perdidas (tema rojo); "Encontremos a su familia" para mascotas encontradas (tema teal/verde azulado — corregido de "azul" tras ver `Mapa.png`/`Home.png`, que usan el teal de marca para "Encontrada", no un azul separado; el mockup manda).
- **Perfil**: editar perfil, notificaciones, privacidad y seguridad, soporte y ayuda.
- Modo claro/oscuro conmutable desde el login.

## Capabilities and Constraints

- Login: correo/contraseña + continuar con Google, Facebook o Apple (confirmado en `Diseño ideal/login.png`; es visual y fuente de verdad por encima de cualquier documento de spec que diga lo contrario).
- Registro: verificación de cuenta por SMS al número registrado; al verificarse, la cuenta recibe automáticamente la insignia azul de verificado. No hay un paso de aprobación manual descrito. Declaración autoinformada de edad mínima durante el registro.
- No se muestran direcciones ni coordenadas exactas de forma predeterminada (regla ya fijada en `docs/legal/tratamiento-de-datos.md`); el mapa trabaja con ubicación aproximada. Aplica también, y especialmente, a reportes de mascotas encontradas (revela dónde vive/está quien encontró la mascota).
- Resuelto (issue #46): la dirección/coordenada exacta nunca se muestra en mapa ni detalle; solo se comparte manualmente por mensaje directo si el dueño decide dársela a alguien.
- El radio de búsqueda ("círculo de vida") se actualiza/amplía automáticamente, y **difiere por especie/temperamento** (issue #10), porque el patrón real de desplazamiento no es el mismo: un perro asustado por un evento traumático puede recorrer varios kilómetros en horas por pánico, mientras que un gato o una mascota tímida/de interior típicamente se esconde cerca y se queda quieta, a veces por días. El formulario de reporte pide especie y, si aplica, si el evento fue traumático (fuegos artificiales, accidente, tormenta, ruido fuerte) — informado por literatura general de búsqueda de mascotas perdidas (p. ej. principios de Missing Animal Response Network), no por consulta directa con un experto certificado; revisar si el piloto (issue #48) muestra datos que la contradigan. Fórmula por perfil, `radio = min(inicial + tasa × √horas, tope)`:

  | Perfil | Inicial | Tasa | Tope |
  | --- | --- | --- | --- |
  | Perro, evento traumático (pánico) | 1000 m | 1200 m·√h | 8 km |
  | Perro, tranquilo/sin evento traumático | 500 m | 400 m·√h | 4 km |
  | Gato o mascota tímida/de interior | 150 m | 60 m·√h | 800 m |
  | Sin especie/temperamento declarado | 300 m | 250 m·√h | 5 km |

  Para el perfil "gato/tímida", el radio pequeño es intencional: la estrategia de búsqueda recomendada es intensiva y cercana (revisar escondites en un radio corto), no expandir agresivamente esperando que se haya desplazado lejos.
- Notificaciones de la app son avisos de la comunidad, explícitamente no alertas gubernamentales ni SMS (aclarado en `docs/legal/consentimientos.md`).
- Publicación y su chat de caso se archivan al marcar la mascota como encontrada; no se eliminan automáticamente.
- Límite de 2 publicaciones por cuenta por día, validado en backend (no solo en el cliente), para prevenir spam.
- El autor de un reporte se muestra con nombre corto/inicial, nunca el nombre completo, a otras personas usuarias — minimización de datos frente a alguien que ya conoce tu ubicación aproximada por el radio de búsqueda.
- La persona usuaria puede exportar sus datos y eliminar su cuenta (derecho de portabilidad y al olvido) de forma autoservicio desde Privacidad y seguridad, además del canal de soporte para solicitudes ARCO.
- Bilingüe desde la arquitectura: español como idioma predeterminado, inglés como segundo idioma soportado desde el día uno de la implementación (ningún texto de UI embebido directamente en componentes).
- Responsive en Android: debe verse correcto en pantallas pequeñas, grandes y plegables, no solo en el tamaño del mockup de referencia.

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

Resuelto (issue #17): WCAG 2.1 nivel AA (contraste, estructura) combinado con las guías
de accesibilidad de Material Design para Android (touch targets, TalkBack). Checklist
completo y aplicación por pantalla en [docs/accesibilidad.md](docs/accesibilidad.md).
