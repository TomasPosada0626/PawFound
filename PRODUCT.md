# Product

<!-- impeccable:product-schema 1 -->

## Platform

android (piloto: APK con actualizaciones por EAS Update); iOS más adelante, con el mismo comportamiento (nada exclusivo de Android en la lógica de la app).

## Stack

Backend: API en Go (router chi, SQL con pgx, contrato OpenAPI en `packages/contracts`), PostgreSQL con PostGIS, WebSockets para el tiempo real y panel de moderación web en `/admin`. App: Expo SDK 57 (React Native) + TypeScript + NativeWind + expo-router, Android primero; español e inglés. Sitio: Astro en Cloudflare Pages. Producción con capas gratuitas: Render (API), Neon (base de datos), Cloudflare R2 (fotos), Brevo (correo) y el servicio push de Expo (notificaciones, por FCM en Android). Sentry está integrado y apagado. Detalle en `docs/ARCHITECTURE.md` y `docs/DESPLIEGUE.md`.

## Users

Comunidad general en Colombia: cualquier persona (familia de una mascota perdida, o vecino/a que encuentra una) que necesita reportar o buscar por zona, y quien quiere adoptar o dar en adopción en PawFamily.

Los refugios y fundaciones usan la misma cuenta: dentro de PawFamily eligen «Soy refugio o fundación» y se verifican con su NIT en el RUES. No es un tipo de cuenta con permisos de moderación. Las veterinarias aparecen como lugares (desde OpenStreetMap), no como cuentas.

Señal de investigación (issues #7/#8, 6 entrevistas): veterinarias y un refugio mostraron interés en publicar una vez y llegar a más gente. La muestra es chica y no concluyente; ver [issue #63](https://github.com/TomasPosada0626/PawFound/issues/63).

## Product Purpose

Reducir el tiempo entre la pérdida de una mascota y su reencuentro seguro con su familia, con reportes claros, búsqueda geolocalizada por zona y coordinación responsable de la comunidad. Éxito = mascotas reencontradas, adopciones responsables y comunicación segura entre quien perdió y quien encontró, sin exponer datos sensibles.

## Métricas de éxito (MVP)

Resuelto (issue #9). Métrica principal: **% de casos «perdida» marcados como «encontrada» dentro de 14 días** desde el reporte (tasa de reencuentro). La app la muestra por ciudad en «Nuestro impacto» solo cuando hay casos suficientes. Ninguna métrica requiere exponer ubicación exacta ni datos personales.

Secundarias:

- Tiempo mediano entre reporte y marcado como encontrada.
- Tasa de activación: % de cuentas nuevas que verifican su correo y completan un reporte o se unen a un grupo de caso dentro de los primeros 7 días.
- Reportes de abuso o moderación por cada 1000 casos publicados.
- Tiempo mediano de respuesta a una acción de moderación.
- Tasa de apertura de la Alerta Ángel (vigilar que no baje por fatiga de notificaciones).

## Positioning

A diferencia de publicar en un grupo genérico de Facebook o de vecinos, PawFound estructura todo el ciclo de un caso:

- cuentas verificadas por correo (insignia azul automática);
- un «círculo de vida» que amplía solo el radio de búsqueda en vez de un pin estático;
- una Alerta Ángel que avisa a quien está cerca, también con la app cerrada;
- un grupo de chat propio por caso («Encontremos a [nombre]» en rojo para perdidas, «Encontremos a su familia» en aguamarina para encontradas).

PawFamily suma la adopción gratuita con solicitudes estructuradas y seguimiento.

## Operating Context

- **Modo exploración**: el inicio, el mapa y el detalle de un caso se ven sin cuenta, en solo lectura. La cuenta se pide al reportar, escribir, unirse a un grupo, o publicar y solicitar en PawFamily (issue #11).
- **Inicio**: casos cercanos, historias, personas conectadas, «Nuestro impacto» y la entrada a PawFamily («¿Quieres adoptar?»).
- **Mapa**: todas las mascotas reportadas como pines (huellita blanca en círculo rojo o aguamarina) y la capa de veterinarias. Al tocar una, se muestra solo ella con su círculo.
- **Detalle de mascota**: fotos, datos, círculo de vida, avistamientos («La vi»), historia y acciones para compartir.
- **Reportar (`+`)**: mascota perdida o encontrada.
- **Mensajes**: Directos, Grupos y Notificaciones.
- **Perfil**: datos públicos, insignias, calificación, seguidores, «Mis mascotas», mis reportes y ajustes (editar perfil, notificaciones, privacidad y seguridad, soporte y ayuda), además de eliminar la cuenta.
- **PawFamily**: buscar, publicar, mis publicaciones, mis solicitudes, panel del refugio y perfil público del refugio.
- Modo claro y oscuro.

## Capabilities and Constraints

### Cuentas

- **Registro**: correo, nombre y apellidos, nombre de usuario (sin caracteres especiales ni `@`) y contraseña con mayúscula, minúscula y número. Declaración de edad mínima.
- **Verificación**: un código de 6 dígitos verifica el correo y otorga la insignia azul. Sin SMS; el celular es opcional y no se verifica.
- **Inicio de sesión**: con correo o nombre de usuario. Sin Google, Apple ni Facebook (decisión del 2026-11-01). La sesión nunca se cierra sola, solo cuando la persona la cierra.
- **Notificaciones**: se piden al registrarse. Se pueden desactivar, pero un letrero avisa que así no llegan las alertas de mascotas perdidas.
- **Eliminar la cuenta**: desde el perfil o en Privacidad y seguridad, escribiendo ELIMINAR para confirmar. Borra todo lo de la cuenta (perfil, reportes y sus grupos, PawFamily, mensajes, chats directos, red, calificaciones, mascotas, ubicación y fotos) y confirma por correo.
- **Exportar los datos**: autoservicio, en Privacidad y seguridad.

### Reportes y búsqueda

- Hasta 2 reportes por cuenta por día, validado en la API.
- De 1 a 5 fotos por reporte.
- El autor aparece con nombre corto («Valentina A.»).
- El celular de contacto en el afiche es opcional y se borra al cerrar el caso.
- **Ubicación siempre aproximada** (issue #46): la dirección o coordenada exacta nunca se muestra en el mapa ni en el detalle. Solo se comparte a mano por mensaje directo.
- **Círculo de vida** (solo perdidas, issue #10): `radio = min(inicial + tasa × √horas, tope)`. Decisión del 2026-10-28: todas arrancan en **250 m** y llegan a **2 km en unos 30 minutos**, porque en las primeras horas es cuando más se mueven. Los perfiles por especie y temperamento siguen en el código con los mismos valores, por si el piloto (issue #48) muestra que conviene diferenciarlos.

  | Momento | Al publicar | 5 min | 15 min | 30 min en adelante |
  | --- | --- | --- | --- | --- |
  | Radio | 250 m | ~960 m | ~1,5 km | 2 km |

- **Encontradas**: sin círculo que crezca. Quien reporta elige el radio de aviso (400 m, 1 km, 2 km o 5 km).
- **En vivo**: un reporte nuevo aparece al instante a quien tiene la app abierta con su cuenta, y deja de verse al instante al cerrarse. Quien explora sin cuenta lo ve en máximo un minuto.
- **Eliminar una publicación**: la familia la quita desde su perfil. Deja de verse para todos y su grupo se cierra.
- **Recordatorios**: a los 3, 7 y 14 días se pregunta a la familia si su mascota ya apareció. Un caso sin novedades se archiva a los 60 días, con aviso 7 días antes.
- **Cierre**: solo quien abrió el caso lo cierra. Puede agradecer a quienes ayudaron (hasta 5) y calificarlos de 1 a 5 estrellas.

### Alertas y avisos

Las notificaciones son avisos de la comunidad, no alertas gubernamentales ni SMS (`docs/legal/consentimientos.md`).

- **Alerta Ángel** (decisiones del 2026-10-28 y 2026-11-01): notificación push por ubicación real.
  - El celular envía su punto aproximado al moverse unos 250 m. El servidor guarda solo el último punto, sin historial, durante 30 días, y lo borra al cerrar la última sesión.
  - Llega al instante si la persona está a menos de 250 m del reporte, o cuando el círculo de vida crece hasta su último punto. Debe llegar con la app cerrada mientras la sesión siga abierta.
  - Una sola alerta por persona y caso, máximo 5 al día, en silencio en modo descanso.
  - Al tocarla abre la pantalla de Alerta Ángel (fotos, «La vi», compartir y aviso de que no es un servicio de emergencia).
  - Reportar una mascota encontrada también avisa a los celulares cercanos.
- **Amigos**: a quien te sigue le llega un aviso cuando se pierde tu mascota (si está en el rango recibe la Alerta Ángel en su lugar) y otro cuando aparece.
- **Coincidencias**: si una mascota encontrada se parece a una perdida cercana, se avisa a la familia. Mientras el círculo crece se vuelve a comparar, una sola vez por coincidencia.
- **«¿Es tu mascota?»**: si se parece a una de «Mis mascotas» (misma especie, cerca de la zona de alertas de la familia, al menos dos señales entre tamaño, sexo, raza y color, y sin contradicciones), la familia recibe «¿Es Rocky?». Es estricta a propósito: una falsa alarma asusta a una familia cuya mascota está en casa.

### Chats

- Cada caso crea su grupo automático. También hay mensajes directos.
- Se pueden enviar fotos en grupos y directos («¿es este?»). La API las vuelve a codificar sin ubicación ni datos del celular, y solo las ven los miembros del chat.
- **Ubicación en el mensaje directo**: la ubicación actual o un punto de encuentro, nunca en grupos ni en vivo. Se quita cuando quien la envió quiere, y deja de verse al cerrar el chat o el caso.
- **Cierre**:
  - Al cerrar el caso se cierran su grupo y sus mensajes directos, que quedan para leer.
  - Un mensaje directo también lo cierra cualquiera de las dos personas.
  - Cada quien archiva o elimina chats de su lista.
- **Veterinaria**: se puede avisar en el grupo a cuál se lleva una mascota encontrada (nombre y dirección pública, no la ubicación de la persona).
- **Sin bloqueos**: nadie bloquea a nadie. Se reporta a la persona (spam, groserías, estafa, contenido inapropiado) con el mensaje como contexto, y moderación aplica sanciones escalonadas (aviso, restricción temporal para escribir, suspensión).
- **Antes de enviar**: la app pregunta con amabilidad si un mensaje podría sonar ofensivo. La API limita a 12 mensajes por minuto.
- **Idioma**: cada mensaje guarda su idioma para poder traducirlo; sin proveedor de traducción configurado, se muestra el original.

### Comunidad y reputación (decisiones del 2026-11-01)

- **Perfiles públicos**: ningún perfil es oculto. Muestran días en PawFound, insignias, calificación, seguidores y seguidos (solo los números) y «me gusta». Nunca muestran celular, correo, ciudad, barrio ni ubicación.
- **Seguirse**: una persona pide y la otra acepta; quedan siguiéndose las dos. Después, cada una deja de seguir o elimina por su lado. A los 3 rechazos se pausa el envío por 30 días. «Mis mascotas» de una persona solo las ven quienes la siguen con la solicitud aceptada.
- **«Me gusta»**: desde el perfil, se siga o no a la persona, y se mantienen aunque se deje de seguir.
- **Calificaciones**: solo por ayudar. Las pone la familia una vez por caso al cerrarlo. El promedio usa las últimas 20 calificaciones reales y solo se muestra desde la décima; antes, la estrella va en gris.
- **Insignias** (issue #61): 12 insignias calculadas por el servidor a partir de hechos reales, nunca compradas ni dadas a mano.
  - Protector verificado, Voz de la comunidad, Rescate solidario, Ojos atentos, Respuesta rápida, Ángel de patas, Megáfono y Manada unida suben por niveles (bronce, plata y oro).
  - Popular sube por «me gusta» (50, 100, 250, 500 y 1000, Leyenda).
  - Protector animal (promedio de más de 4,5 desde la décima calificación; se gana y se pierde), De vuelta a casa y Nuevo integrante (adoptó en PawFamily) tienen un solo nivel.
  - Los reportes retirados por moderación o eliminados dejan de contar: publicar y borrar no sube de nivel.
- **Fundador**: la cuenta de quien creó PawFound tiene la etiqueta «Fundador de PawFound». Solo identifica, sin «me gusta» ni insignias inflados.

### Más herramientas del caso

- **Mis mascotas**: perfil preventivo de hasta 10 mascotas. Si una se pierde, «Se perdió» publica el reporte ya lleno.
- **Afiche con QR** para imprimir o compartir por WhatsApp. El QR abre la página pública del caso (`pawfound.pages.dev/mascota/<id>`), que a su vez abre la app.
- **Historias dentro de PawFound**: no vencen. Se quitan cuando la familia las borra o cuando la mascota vuelve a casa.
- **Historia para Instagram** (9:16), con el enlace copiado para el sticker «Enlace». Instagram la borra a las 24 horas, así que la app guía a guardarla en Destacadas. Al cerrarse el caso se avisa a quienes lo compartieron.
- **Veterinarias** del Valle de Aburrá desde OpenStreetMap. Al reportar una mascota encontrada, «¿Está herida?» muestra las 5 más cercanas. «Vamos» abre la ruta en Waze o Google Maps.

### PawFamily (adopción responsable)

- Se entra desde Inicio y se aceptan las políticas al entrar:
  - la adopción es 100 % gratuita;
  - los datos deben ser verdaderos;
  - quien pide dinero se reporta, y moderación retira la publicación y puede suspender la cuenta.
- **Buscar**: cerca, con distancia elegible o en toda la ciudad. Filtros de especie, sexo, tamaño y edad. Sin filtro de raza, porque los criollos no tienen raza.
- **Publicar**: de 1 a 5 fotos, datos, zona y, si se quiere, la dirección. La dirección solo la ven quien publica y la persona aceptada.
- **Solicitar**: nombre, cuántas personas viven en la casa, barrio y ciudad, si ha tenido mascotas y cuántas, y por qué quiere adoptar. Quien publica recibe aviso en la app y por correo.
- **Decidir**: quien publica acepta o rechaza. Al aceptar se abre un chat directo. Una solicitud sin respuesta vence a los 14 días, sin límite de solicitudes por persona.
- **Seguimiento**: a los 7 y 30 días de adoptar se le pide a la nueva familia una foto de cómo está la mascota. Quien la dio en adopción la ve.
- **Refugios** (decisión del 2026-11-03): verificación 100 % automática con el RUES de Confecámaras.
  - Una fundación, asociación o corporación activa con el mismo nombre y dígito de verificación queda verificada al instante. Si no, se rechaza diciendo qué corregir.
  - Solo espera si el RUES no responde, y entonces se reintenta cada hora.
  - Cada mes se revisan los verificados: pierden la verificación si la matrícula se cancela.
  - Un NIT verifica una sola cuenta. Moderación puede quitar una verificación (por ejemplo, si alguien usa el NIT de otra fundación) y la cuenta ya no puede verificarse sola.
  - El refugio verificado tiene su panel y un perfil público con lo que tiene en adopción y sus adopciones logradas.
- **Compartir**: una publicación de adopción se puede compartir.

### Plataforma

- Bilingüe desde la arquitectura: español predeterminado e inglés, sin textos de interfaz dentro de los componentes.
- Responsive en Android: pantallas pequeñas, grandes y plegables, no solo el tamaño del mockup.

## Brand Commitments

Nombre: **PawFound**. Isotipo: pin con silueta de perro o gato dentro de una huella, en gradiente aguamarina (teal) sobre azul marino oscuro para el wordmark. PawFamily usa el mismo pin en coral con un corazón. Tagline: «Conectamos patas, reunimos familias». Colores de estado: perdidas en **rojo**, encontradas en **aguamarina**, siempre acompañados de texto o ícono. Modo claro y oscuro. Interfaz profesional y tierna.

## Evidence on Hand

- 16 pantallas de referencia visual en `Diseño ideal/` (nombres literales): `login.png`, `Registro.png`, `Home.png`, `Mapa.png`, `Mascota especifica.png`, `Reporte perdida.png`, `Reporte encontrada.png`, `Chats DM.png`, `Chats Grupos.png`, `Chatss notificaciones.png`, `Pefil.png`, `Editar perfil.png`, `Notificaciones.png`, `Privacidad y seguridad.png`, `Soporte y ayuda.png`, `Alerta Angel.png`. Son la referencia de cómo deben verse las pantallas. Algunas decisiones posteriores las reemplazan: Alerta Ángel por push y no por SMS, y sin inicio de sesión social.
- Capturas reales de la app (modo demostración, datos de ejemplo) en `assets/capturas/`.
- La app, la API y el sitio están en producción para el piloto. Todavía no hay métricas, testimonios ni casos de estudio publicables: no inventar ninguno.
- `docs/legal/*.md`: política de privacidad, términos y borradores internos para Colombia, pendientes de revisión legal formal.

## Product Principles

1. Bienestar y seguridad animal primero, por encima de la conveniencia de producto.
2. Verificación real (correo) antes que confianza implícita. La insignia azul significa correo verificado, no reputación.
3. Minimizar la exposición de datos sensibles por defecto (ubicación aproximada, nunca exacta).
4. Cada caso es una unidad de coordinación propia: su grupo, su radio de búsqueda y su historia.
5. Herramienta comunitaria gratuita, sin publicidad ni pagos en el flujo de ayuda ni en la adopción.
6. Sin textos falsos: nada de datos de demostración en producción ni promesas que la app no pueda cumplir.

## Accessibility & Inclusion

Resuelto (issue #17): WCAG 2.1 nivel AA (contraste, estructura) combinado con las guías de accesibilidad de Material Design para Android (touch targets, TalkBack). Checklist completo y aplicación por pantalla en [docs/accesibilidad.md](docs/accesibilidad.md).
