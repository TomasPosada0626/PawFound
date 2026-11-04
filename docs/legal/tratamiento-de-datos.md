# Borrador de política de tratamiento de datos personales

> Este documento es un borrador técnico para PawFound y no constituye asesoría legal.
> Debe ser revisado y aprobado por asesoría legal especializada en Colombia antes del
> lanzamiento o de recopilar datos personales. La versión de cara al usuario, derivada
> de este borrador, vive en [politica-de-privacidad.md](politica-de-privacidad.md).

## Base legal

Este borrador se orienta al marco colombiano de protección de datos personales: Ley
Estatutaria 1581 de 2012, su decreto reglamentario 1377 de 2013, y la Ley 1266 de 2008
en lo que aplique a datos de contacto y verificación. La versión final debe confirmarse
con asesoría legal antes de producción, incluyendo si aplica registro ante el Registro
Nacional de Bases de Datos (RNBD) de la Superintendencia de Industria y Comercio (SIC) —
verificar el umbral vigente; es recomendable registrar desde el inicio antes que asumir
que no aplica.

## Menores de edad

Para crear una cuenta hay que confirmar que se tienen 18 años o más. Aun así, una persona menor
podría declarar otra edad o usar la app con un adulto. El tratamiento reforzado de sus datos
(consentimiento de representante legal, minimización adicional) sigue siendo un punto abierto
para la revisión legal.

## Datos y finalidades

PawFound trata datos de cuenta, perfil y red (seguidores, «me gusta», calificaciones),
reportes de mascotas, publicaciones y solicitudes de adopción, mensajes, reportes de moderación,
consentimientos, datos técnicos mínimos y ubicación aproximada. De los refugios guarda además su
nombre, su NIT, la razón social que devuelve el RUES y el resultado de esa revisión. Se usan para
prestar el servicio, prevenir abuso, atender solicitudes, mejorar la seguridad y cumplir
obligaciones legales; nunca para publicidad ni se venden. No se mostrarán direcciones ni coordenadas exactas de forma predeterminada. La
excepción es la ubicación que la persona decide enviar en un mensaje directo (su ubicación
actual o un punto de encuentro, nunca en grupos y nunca en vivo): solo la ve la otra persona
y sus coordenadas se borran cuando quien la envió la quita, cuando se cierra la conversación
o cuando se cierra el caso.

## Derechos y solicitudes

La persona titular podrá consultar, actualizar, rectificar, solicitar eliminación, revocar
consentimientos y pedir exportación de sus datos por los canales publicados en la app. Estos
son los derechos de acceso, rectificación, cancelación y oposición (ARCO) reconocidos por la
Ley 1581 de 2012. Las solicitudes se registrarán, verificarán y atenderán dentro de los
plazos legales aplicables, por el correo [pawfoundoficial@gmail.com](mailto:pawfoundoficial@gmail.com) o el canal descrito en
[SUPPORT.md](../../SUPPORT.md).

## Transferencias y encargados

Cada proveedor queda en el inventario antes de activarse, con qué datos recibe y para qué. Hoy
procesan datos fuera de Colombia, principalmente en Estados Unidos:

- Render (API) y Neon (base de datos);
- Cloudflare (fotos, sitio web y red);
- Brevo (correo);
- Expo y Firebase Cloud Messaging (notificaciones);
- Google Maps (mapa).

Para verificar refugios se consulta el NIT en datos.gov.co. El inventario completo está en
[incidentes-y-proveedores.md](incidentes-y-proveedores.md). Las salvaguardas de cada
transferencia internacional quedan para la revisión legal.

## Retención

Los plazos vigentes están en la sección 5 de la [política de privacidad](politica-de-privacidad.md);
quedan sujetos a la revisión legal.

- **Casos**: se archivan al cerrarse o a los 60 días sin novedades. Al cerrarse un caso se cierran
  su grupo y sus mensajes directos, que quedan para leer, y se quitan sus historias. Un mensaje
  directo también lo cierra cualquiera de las dos personas, y cada una archiva o elimina chats de
  su lista.
- **Ubicaciones**: las coordenadas de una ubicación compartida en un chat se borran en cuanto deja
  de ser visible. La ubicación para alertas guarda solo el último punto y se borra al cerrar la
  última sesión o a los 30 días sin actualizarse.
- **PawFamily**: una solicitud sin respuesta vence a los 14 días.
- **Cuenta**: al eliminarla se borra todo lo de la cuenta. En los grupos de otros casos solo quedan
  los avisos automáticos, sin su nombre.
- **Respaldos**: copias cifradas que se borran a los 30 días.
