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

## Inventario inicial de proveedores previstos

| Proveedor | Uso previsto | Datos potenciales | Estado |
| --- | --- | --- | --- |
| Supabase (PostgreSQL/PostGIS) | base de datos, solo para desarrollo/MVP | todos los datos de la app | por evaluar — no es la solución definitiva de producción |
| Cloudflare R2 | imágenes, subida directa con URL firmada | archivos sin EXIF | por evaluar |
| Firebase Cloud Messaging | notificaciones Android | token y mensaje mínimo | por evaluar |
| Upstash Redis | caché y límites | claves técnicas efímeras | por evaluar |
| Sentry | errores | telemetría minimizada | por evaluar |

No se habilitará un proveedor hasta completar evaluación de seguridad, contrato y revisión
de privacidad aplicable.
