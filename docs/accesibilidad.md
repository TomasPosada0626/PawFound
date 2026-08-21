# Estándar de accesibilidad

Resuelve [issue #17](https://github.com/TomasPosada0626/PawFound/issues/17). Estándar de
referencia para toda la app, no solo para un flujo — cada spec en `docs/flujos/` enlaza
acá en vez de repetir estos puntos.

## Estándar elegido

**WCAG 2.1 nivel AA** para contraste y estructura de contenido, combinado con las **guías
de accesibilidad de Material Design para Android** (coherente con que la app sigue
Material 3 como base de componentes nativos, no controles estilo iOS).

## Checklist aplicable a toda pantalla

- **Contraste de color**: texto normal ≥ 4.5:1, texto grande (≥18pt, o ≥14pt en negrita)
  ≥ 3:1, íconos y componentes de UI interactivos ≥ 3:1 contra su fondo. Se valida contra
  los tokens de marca (`teal` `#1FA98F`, `navy` `#0B2545`) en modo claro y oscuro por
  separado — un contraste que pasa en claro no garantiza que pase en oscuro.
- **Touch targets**: mínimo 48×48dp, con al menos 8dp de separación entre elementos
  interactivos contiguos (estándar Material, no el 44pt de iOS).
- **Lector de pantalla (TalkBack)**: todo elemento interactivo con `accessibilityLabel`
  real, no solo ícono; cambios de estado asíncronos (error, confirmación, carga) se
  anuncian vía `accessibilityLiveRegion`, no solo cambio visual.
- **Nunca solo color**: ningún significado se transmite únicamente por color. Aplica
  directo al esquema rojo/teal de "perdida"/"encontrada" — siempre acompañado de texto o
  ícono, nunca solo el tinte del elemento.
- **Texto escalable**: unidades `sp` en la app (no tamaños fijos en `px`), para respetar
  el ajuste de tamaño de fuente del sistema operativo.
- **Modo oscuro**: esquema completo de primera clase, no una inversión automática — ya
  cubierto por el toggle de tema definido en el flujo de login.
- **Navegación**: el gesto/botón de "Atrás" del sistema Android siempre funciona; ningún
  flujo atrapa a la persona usuaria sin salida.

## Revisión retroactiva del flujo ya diseñado

[`docs/flujos/onboarding-login-registro.md`](flujos/onboarding-login-registro.md) (#11),
único flujo existente hasta ahora:

- Labels reales en campos, `accessibilityLabel` en el ícono de contraseña y en las
  casillas del código SMS, anuncio de error del SMS por región viva, dos botones de tema
  con estado — todo ya definido en la crítica de #11, consistente con este estándar.
- **Falta agregar**: nota explícita de touch targets ≥48dp en los botones/checkboxes del
  flujo. Se agrega en este mismo cambio (ver el flujo actualizado).

## Cómo se aplica de acá en adelante

Cada issue de diseño de flujo (#12–#16) reemplaza su sección "Accesibilidad" genérica por
una lista de puntos específicos de esa pantalla contra este checklist, en vez de diferirlo
a una issue futura.
