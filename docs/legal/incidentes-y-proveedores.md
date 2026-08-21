# Incidentes, inventario y proveedores

> Borrador técnico; requiere validación legal y operativa previa a producción.

## Respuesta a incidentes

1. Detectar, registrar y clasificar el incidente sin copiar datos innecesarios.
2. Contener, preservar evidencia y evaluar el impacto con seguridad y legal.
3. Notificar a titulares, autoridades o proveedores cuando la norma y el riesgo lo exijan,
   incluyendo a la Superintendencia de Industria y Comercio (SIC) dentro de los plazos que
   fije la normativa colombiana vigente para incidentes de seguridad de datos personales.
4. Recuperar, documentar causa raíz y verificar acciones correctivas.

## Inventario inicial de proveedores previstos

| Proveedor | Uso previsto | Datos potenciales | Estado |
| --- | --- | --- | --- |
| Cloudflare R2 | imágenes | archivos sin EXIF | por evaluar |
| Firebase Cloud Messaging | notificaciones Android | token y mensaje mínimo | por evaluar |
| Upstash Redis | caché y límites | claves técnicas efímeras | por evaluar |
| Sentry | errores | telemetría minimizada | por evaluar |

No se habilitará un proveedor hasta completar evaluación de seguridad, contrato y revisión
de privacidad aplicable.
