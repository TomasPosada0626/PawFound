# Incidentes, inventario y proveedores

> Borrador técnico; requiere validación legal y operativa previa a producción.

## Respuesta a incidentes

1. Detectar, registrar y clasificar el incidente sin copiar datos innecesarios.
2. Contener, preservar evidencia y evaluar el impacto con seguridad y legal.
3. Notificar a titulares, autoridades o proveedores cuando la norma y el riesgo lo exijan,
   incluyendo a la Superintendencia de Industria y Comercio (SIC) dentro de un plazo
   objetivo de 72 horas desde la detección para incidentes de seguridad de datos
   personales — confirmar este plazo con asesoría legal antes de producción, ya que es un
   objetivo operativo, no todavía una cita textual de la norma vigente verificada por un
   abogado.
4. Recuperar, documentar causa raíz y verificar acciones correctivas.

## Proveedores en uso

| Proveedor | Uso | Datos que recibe | Estado |
| --- | --- | --- | --- |
| Render (EE. UU., Virginia) | aloja la API | lo que pasa por la API mientras se atiende; registros técnicos (ruta, estado y duración de cada petición), sin el contenido de los mensajes | en uso |
| Neon (PostgreSQL/PostGIS, EE. UU., Virginia) | base de datos | todos los datos de la app | en uso |
| Cloudflare R2 | fotos | fotos re-codificadas en JPEG, sin EXIF ni GPS | en uso |
| Cloudflare Pages | sitio web (pawfound.pages.dev) | visitas a la web; la página /restablecer envía la nueva contraseña directo a la API | en uso |
| Brevo | correos de verificación y restablecimiento | correo, nombre y el código o enlace | en uso |
| Expo (EAS Build y Update) | compilar la app y publicar actualizaciones | ninguno de las personas usuarias | en uso |
| Expo Push Service | entregar notificaciones push | token push del celular y el texto de la notificación | en uso |
| Firebase Cloud Messaging (Google) | entregar las notificaciones en Android | token push del celular y el texto de la notificación | evaluado (ver abajo) |
| Google Maps SDK (Android) | mapa dentro de la app | la zona del mapa que se ve y datos técnicos del celular, según los términos de Google | en uso |
| OpenStreetMap / Overpass | importar veterinarias desde el servidor | ninguno de las personas usuarias | en uso |
| GitHub | código y revisiones automáticas | ninguno de las personas usuarias | en uso |

Ningún proveedor se habilita sin evaluar antes qué datos recibe, para qué y por cuánto
tiempo.

## Evaluación: Firebase Cloud Messaging

- **Para qué:** Android solo entrega notificaciones push a través de FCM. Sin FCM, la Alerta
  Ángel y los avisos de chats solo se ven al abrir la app.
- **Datos:** el token push del celular (identificador técnico, no es el número ni el correo) y
  el texto de cada notificación: título y cuerpo con el nombre de la mascota y el tipo de
  aviso, más la ruta del caso dentro de la app. Nunca coordenadas, dirección, teléfono ni
  correo.
- **Camino:** la API envía la notificación a Expo Push Service, que la entrega a FCM, que la
  lleva al celular.
- **Sin analítica:** el proyecto de Firebase se crea sin Google Analytics; solo se usa
  Cloud Messaging.
- **Conservación:** FCM guarda el mensaje solo hasta entregarlo (o hasta que vence si el
  celular está apagado). PawFound guarda el token mientras la sesión esté abierta en ese
  celular: se borra al cerrar sesión o eliminar la cuenta.
- **Control de la persona:** el permiso de notificaciones se puede negar o quitar en
  cualquier momento; cada tipo de aviso se puede apagar en Ajustes → Notificaciones.
