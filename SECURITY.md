# Política de seguridad

## Reportar una vulnerabilidad

No publiques vulnerabilidades ni datos sensibles en Issues, pull requests ni discusiones públicas.

Repórtala en privado, por la opción **Report a vulnerability** de la pestaña *Security* del
repositorio si está disponible, o al correo
[pawfoundoficial@gmail.com](mailto:pawfoundoficial@gmail.com) con el asunto «Seguridad». Incluye:

- Descripción del problema y la parte afectada (app, API, panel `/admin` o sitio web).
- Impacto potencial.
- Pasos para reproducirlo o una prueba de concepto segura.
- Recomendación de mitigación, si la tienes.

Recibirás una confirmación y, cuando sea posible, una actualización sobre la evaluación.

## Reglas para probar

- No accedas, modifiques ni expongas datos de otras personas. Usa tus propias cuentas de prueba.
- No hagas pruebas de denegación de servicio ni envíos masivos: la API corre en planes gratuitos con
  cuotas reducidas.
- No uses ingeniería social contra personas usuarias ni contra quien mantiene el proyecto.

## Alcance

- La app de Android, la API (`pawfound-api.onrender.com`), el panel de moderación y el sitio
  `pawfound.pages.dev`.
- Este repositorio, incluido cualquier secreto que haya quedado en el historial.

`pawfound.vercel.app` no pertenece a este proyecto.
