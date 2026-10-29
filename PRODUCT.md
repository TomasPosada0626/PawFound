# Product

<!-- impeccable:product-schema 1 -->

## Platform

android (lanzamiento); iOS más adelante, con el mismo comportamiento (nada exclusivo de Android en la lógica de la app)

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

A diferencia de publicar en un grupo genérico de Facebook/vecinos, PawFound estructura todo el ciclo de un caso: cuentas verificadas por correo (insignia azul automática al verificar), un "círculo de vida" por mascota que amplía automáticamente su radio de búsqueda con el tiempo en vez de un pin estático, y un grupo de chat dedicado que se crea solo por caso ("Encontremos a [nombre]" en rojo para perdidas, "Encontremos a su familia" en azul para encontradas) en lugar de mezclar todos los reportes en un solo hilo.

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

- Login: correo o nombre de usuario y contraseña + continuar con Google o Apple. Facebook se quitó (decisión del 2026-10-28).
- Registro: verificación de cuenta por SMS al número registrado; al verificarse, la cuenta recibe automáticamente la insignia azul de verificado. No hay un paso de aprobación manual descrito. Declaración autoinformada de edad mínima durante el registro.
- No se muestran direcciones ni coordenadas exactas de forma predeterminada (regla ya fijada en `docs/legal/tratamiento-de-datos.md`); el mapa trabaja con ubicación aproximada. Aplica también, y especialmente, a reportes de mascotas encontradas (revela dónde vive/está quien encontró la mascota).
- Resuelto (issue #46): la dirección/coordenada exacta nunca se muestra en mapa ni detalle; solo se comparte manualmente por mensaje directo si el dueño decide dársela a alguien.
- El radio de búsqueda ("círculo de vida") se actualiza/amplía automáticamente, y **difiere por especie/temperamento** (issue #10), porque el patrón real de desplazamiento no es el mismo: un perro asustado por un evento traumático puede recorrer varios kilómetros en horas por pánico, mientras que un gato o una mascota tímida/de interior típicamente se esconde cerca y se queda quieta, a veces por días. El formulario de reporte pide especie y, si aplica, si el evento fue traumático (fuegos artificiales, accidente, tormenta, ruido fuerte) — informado por literatura general de búsqueda de mascotas perdidas (p. ej. principios de Missing Animal Response Network), no por consulta directa con un experto certificado; revisar si el piloto (issue #48) muestra datos que la contradigan. Fórmula por perfil, `radio = min(inicial + tasa × √horas, tope)`:

  **Decisión del 2026-10-28**: todas las mascotas arrancan en **250 m** alrededor del último punto y llegan a **2 km en unos 30 minutos** (tasa = 1750 m / √0,5 h = 2475 m·√h): en las primeras horas es cuando más se mueven y cuando más sirve avisar a los vecinos. Los perfiles por especie y temperamento se conservan en el código con los mismos valores, para volver a diferenciar la velocidad si el piloto (issue #48) lo muestra.

  | Momento | Al publicar | 5 min | 15 min | 30 min en adelante |
  | --- | --- | --- | --- | --- |
  | Radio | 250 m | ~960 m | ~1,5 km | 2 km |

  La Alerta Ángel sigue al círculo: la API lo revisa cada minuto (`JOBS_INTERVAL`), así que quienes quedan dentro mientras crece reciben el aviso en ese lapso. "¿Es tu mascota?" usa su propio alcance, más amplio (perro 8 km, gato 800 m, otra 5 km, más 500 m de margen), porque una coincidencia perdida cuesta más que preguntar de más. En el mapa, al tocar una mascota se muestra solo ella con su círculo vigente relleno (rojo claro si está perdida) y el anillo de 2 km hasta donde crecerá.
- Notificaciones de la app son avisos de la comunidad, explícitamente no alertas gubernamentales ni SMS (aclarado en `docs/legal/consentimientos.md`).
- **Alerta Ángel = notificación push de la app** (decisión del 2026-10-28, reemplaza el SMS del mockup `Alerta Angel.png`): cero costo por mensaje y controlable desde ajustes. Al publicarse una mascota perdida, la reciben los celulares cuya zona de alertas (punto aproximado de 250 m, guardado con consentimiento) queda dentro del círculo de vida inicial; a medida que el círculo crece, la reciben los que van quedando dentro. Una sola alerta por persona y caso, máximo 5 por persona al día, silenciosa en modo descanso. Al tocarla abre la pantalla de Alerta Ángel (fotos, "La vi", compartir, aviso de que no es un servicio de emergencia).
- **Insignias** (issue #61): 8 insignias calculadas por el servidor a partir de hechos reales, con niveles bronce/plata/oro por color del borde: Protector verificado, Voz de la comunidad (reportes), Rescate solidario (encontradas), Ojos atentos (avistamientos en casos ajenos), Ángel de patas (la familia te agradece al cerrar su caso; solo entre quienes participaron, máx. 5), De vuelta a casa (un solo nivel), Megáfono (casos compartidos) y Manada unida (grupos de casos ajenos). Nunca se compran ni se otorgan a mano; los reportes retirados por moderación dejan de contar.
- **Perfiles públicos y "me gusta"**: ningún perfil es oculto. Se abre desde un caso, un chat directo o tocando el nombre de quien escribe en un grupo, y muestra días en PawFound, insignias, mascotas (foto, nombre y especie) y "me gusta". Solo cuentas verificadas dan "me gusta", uno por persona. Nunca se muestran celular, correo ni dirección.
- **Sin bloqueos**: nadie bloquea a nadie; se reporta a la persona (spam, groserías, estafa, contenido inapropiado) con el mensaje como contexto, y moderación aplica sanciones escalonadas (aviso → restricción temporal para escribir → cierre de cuenta). La app pregunta con amabilidad antes de enviar un mensaje que podría sonar ofensivo, y la API limita los mensajes por minuto.
- **Mis mascotas**: perfil preventivo de cada mascota propia; si se pierde, "Se perdió" publica el reporte ya lleno y solo falta confirmar dónde y cuándo.
- **Afiche con QR** para imprimir o compartir por WhatsApp, sin teléfono ni dirección: el QR abre el caso.
- **Decisiones del 2026-10-28 (segunda ronda)**:
  - **Alerta Ángel por ubicación real (GPS)**, no por una zona fija: llega si la persona está a menos de 250 m del reporte al publicarse, o cuando el círculo de vida crece hasta su ubicación actual. Solo se guarda el último punto aproximado, sin historial, y deja de usarse a las 24 h sin actualizar.
  - **Verificación gratis por correo**: la insignia azul es un correo verificado con un código de 6 dígitos (Google y Apple llegan verificados). Sin SMS; el celular es opcional y no se verifica.
  - **Registro**: correo, nombre y apellidos, nombre de usuario y contraseña segura (mayúscula, minúscula y número). Login con correo o usuario. Al verificar se celebra la primera insignia.
  - **Notificaciones**: se piden al registrarse; se pueden desactivar, pero un letrero avisa que así no llegan las alertas de mascotas perdidas.
  - **Chats**: ninguno se cierra ni se borra solo al terminar el caso. El mensaje directo lo cierra a mano una de las dos personas; cada quien archiva o elimina chats de su lista.
  - **Historias dentro de PawFound** que no vencen: se quitan cuando la familia las borra o cuando la mascota vuelve a casa. Se mantiene también la historia para compartir en Instagram (con guía para Destacadas).
  - **Veterinarias** del Valle de Aburrá desde OpenStreetMap: capa del mapa y, al reportar una
    mascota encontrada, "¿Está herida? Busquemos la veterinaria más cercana" (antes del
    formulario y al publicar). "Vamos" abre la ruta en Waze o Google Maps y se puede avisar en
    el grupo del caso a qué veterinaria va. Sin refugios: en Medellín no reciben mascotas.
  - **Ubicación en el mensaje directo**: ubicación actual o punto de encuentro, nunca en grupos
    ni en vivo. Se quita cuando quien la envió quiere y deja de verse al cerrar el chat o el
    caso.
  - **Sitio de lanzamiento** (`apps/web`) con el tutorial de primera vez, la guía y la ayuda. El panel de moderación vive solo en `/admin` y suma la actividad de la app.
- **Historia para Instagram** (9:16) con el enlace copiado para el sticker «Enlace». Instagram borra las historias a las 24 horas y PawFound no puede impedirlo: la pantalla guía a guardarla en Destacadas (queda hasta que quien la publicó la quite) y, al cerrarse el caso, se avisa a quienes lo compartieron para que la quiten o compartan la buena noticia.
- **Fotos en el chat**, en grupos de caso y en mensajes directos ("¿es este?"). Se envían sin ubicación ni datos del celular: la API re-codifica cada foto y solo los miembros del chat pueden verla.
- **"¿Es tu mascota?"**: si alguien reporta una mascota encontrada que se parece a una de "Mis mascotas" (misma especie, cerca de la zona de alertas de la familia y al menos dos señales entre tamaño, sexo, raza y color, sin contradicciones), su familia recibe "¿Es Rocky?". Es estricta a propósito: una falsa alarma asusta a una familia cuya mascota está en casa. Se controla con "Mascotas encontradas cerca".
- Publicación y su chat de caso se archivan al marcar la mascota como encontrada; no se eliminan automáticamente.
- Límite de 2 publicaciones por cuenta por día, validado en backend (no solo en el cliente), para prevenir spam.
- El autor de un reporte se muestra con nombre corto/inicial, nunca el nombre completo, a otras personas usuarias — minimización de datos frente a alguien que ya conoce tu ubicación aproximada por el radio de búsqueda.
- La persona usuaria puede exportar sus datos y eliminar su cuenta (derecho de portabilidad y al olvido) de forma autoservicio desde Privacidad y seguridad, además del canal de soporte para solicitudes ARCO.
- Chats traducidos automáticamente al idioma de cada persona (español/inglés), con opción de
  ver el original; la traducción la hace la API con un proveedor evaluado, nunca el cliente.
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
