# Flujo: onboarding, login y registro con verificación SMS

Especificación de flujo para [issue #11](https://github.com/TomasPosada0626/PawFound/issues/11).
Fuente visual: [`Diseño ideal/login.png`](../../Diseño%20ideal/login.png) y
[`Diseño ideal/Registro.png`](../../Diseño%20ideal/Registro.png) — el mockup manda sobre
esta descripción si hay conflicto, salvo donde se indica explícitamente que el mockup no
cubre algo.

## Mapa del flujo

```text
(abrir app)
    │
    ▼
 Mapa/Home en modo exploración (sin cuenta, solo lectura)
    │
    │  tocar Reportar / Contactar / Unirse a un grupo
    ▼
 Login ──────────────► Registro ──────► Verificación SMS ──────► Home (con cuenta)
    ▲          │                              │
    │          └── continuar con Google/      │
    │              Facebook/Apple ──► ¿tiene   │
    │                                 teléfono │
    │                                 verificado?
    │                                 no → Verificación SMS
    │                                 sí → Home
    └────────────────── "cambiar número" ──────┘
```

## 0. Modo exploración (resuelve el P0 de la crítica: sin recorrido rápido)

**Cambio respecto a la v1 de este documento**: no hay onboarding/carousel en
`Diseño ideal/`, pero tampoco hay razón para forzar una cuenta antes de poder ver el mapa
— alguien puede abrir la app porque su mascota se perdió *ahora mismo* y necesita ver qué
hay cerca antes que nada. El Mapa/Home son visibles **sin cuenta, en solo lectura**:
se pueden ver pines y reportes cercanos. Crear cuenta (Login/Registro) se pide recién al
intentar una acción que lo requiere: reportar, contactar por chat, o unirse a un grupo de
caso. Esto es una decisión de producto nueva tomada acá, no estaba en el mockup original;
queda reflejada también en PRODUCT.md.

## 1. Login (`login.png`)

- Campos: correo electrónico, contraseña (con toggle de mostrar/ocultar).
- Checkbox "Recordar sesión" — **pre-marcado por defecto** (así lo muestra `login.png`;
  no es un consentimiento legal como el de Términos, es una preferencia de sesión, así que
  no aplica la regla de "nunca preseleccionado").
- Enlace "¿Olvidaste tu contraseña?".
- Botón primario "Iniciar sesión".
- Continuar con Google, Facebook o Apple.
- Enlace "¿No tienes cuenta? Regístrate" → Registro.
- **Dos íconos** de modo claro/oscuro en las esquinas superiores (sol a la izquierda, luna
  a la derecha) — no es un único control tipo switch; cada ícono es un botón que activa su
  modo. Corrige la v1 de este documento, que los describía como un solo toggle.

### Estados de error — Login

- Credenciales inválidas: mensaje inline genérico ("correo o contraseña incorrectos"),
  sin indicar cuál de los dos falló — evita que alguien confirme si un correo tiene cuenta.
- Cuenta registrada pero sin verificar por SMS: no inicia sesión; redirige a Verificación
  SMS con el número ya guardado.
- Proveedor social cancelado o falló: mensaje breve, vuelve a Login sin bloquear el resto
  del formulario.
- Campo vacío: se valida al perder el foco, no solo al enviar.
- **Sin conexión**: si el envío falla por red (no por credenciales), se muestra un banner
  "Sin conexión — no pudimos iniciar sesión, revisá tu internet e intentá de nuevo" con
  botón "Reintentar"; los campos no se limpian.

### Login social y verificación SMS (resuelve el P0 de la crítica: relación indefinida)

**Cambio respecto a la v1**: Google/Facebook/Apple autentican identidad, pero no
confirman un número de teléfono colombiano real — que es específicamente lo que la
insignia azul certifica (PRODUCT.md § Product Principles, punto 2). Por eso:

- Continuar con un proveedor social crea o recupera la cuenta y entra a Home
  inmediatamente (sin bloquear la exploración/lectura).
- Si la cuenta no tiene un teléfono verificado todavía, cualquier intento de **reportar,
  contactar por chat o unirse a un grupo** redirige primero a un paso de "Agregá y
  verificá tu número" (pide el teléfono si falta, luego reutiliza la pantalla de
  Verificación SMS) antes de completar la acción.
- La insignia azul se otorga en ese momento, igual que en el registro por correo — no hay
  un camino alternativo que la otorgue sin SMS.

## 2. Registro (`Registro.png`)

- Campos: nombre completo, correo electrónico, número de teléfono, contraseña, confirmar
  contraseña.
- Checkbox "Acepto los Términos y Condiciones y la Política de Privacidad" — **no
  preseleccionado** (coincide con el principio de consentimiento explícito ya definido).
- Botón primario "Crear cuenta".
- Enlace "¿Ya tienes cuenta? Inicia sesión" → Login.

### Dos cosas que el mockup no resuelve, decididas acá

- **Declaración de edad mínima**: no está en `Registro.png` porque ese requisito
  (PRODUCT.md, fusión del documento maestro) se definió después de hacerse el mockup. Se
  agrega como checkbox obligatorio adicional, mismo estilo que el de Términos.
- **Proveedores sociales inconsistentes entre mockups**: `login.png` muestra Google,
  Facebook y Apple; `Registro.png` solo muestra Google. No hay ninguna razón funcional
  para que el registro tenga menos opciones que el login — se muestran los tres en ambas
  pantallas.

### Validaciones — Registro

- Nombre completo: requerido.
- Correo: formato válido; si ya existe una cuenta con ese correo, el mensaje sí lo dice
  explícitamente ("ese correo ya tiene una cuenta — iniciá sesión") porque en registro,
  a diferencia del login, ayudar a la persona a encontrar su cuenta pesa más que el riesgo
  de enumeración.
- Teléfono: formato colombiano válido, único por cuenta (un número no verifica dos
  cuentas a la vez).
- Contraseña: mínimo razonable (a definir el umbral exacto con la API, ver issue #33) +
  debe coincidir con "Confirmar contraseña".
- Checkboxes de Términos y de edad mínima: el botón "Crear cuenta" queda deshabilitado
  hasta marcar ambos, no solo error al enviar.
- **Sin conexión**: mismo patrón que Login — banner "Sin conexión" con "Reintentar",
  campos preservados, sin perder lo ya escrito.

## 3. Verificación SMS (pantalla nueva — no existe en `Diseño ideal/`)

No está entre las 16 pantallas de referencia; se diseña acá porque el flujo la necesita,
manteniendo el lenguaje visual ya establecido (isotipo arriba, tarjeta blanca redondeada,
botón primario teal, tipografía y espaciado consistentes con `login.png`/`Registro.png`).

- Título: "Verificá tu número".
- Subtítulo: "Te enviamos un código de 6 dígitos a +57 XXX XXX XXXX" (número parcialmente
  oculto).
- 6 casillas de un dígito, avance automático al escribir cada una; tocar una casilla ya
  llena permite corregir ese dígito sin borrar las demás.
- **Autocompletado nativo de Android** (resuelve el P1 de la crítica): usar la SMS
  Retriever API o SMS User Consent API de Android para completar las 6 casillas
  automáticamente al llegar el mensaje, sin que la persona copie el código a mano. Esto
  requiere un dev client / build de EAS, no funciona en Expo Go — queda anotado como
  dependencia técnica para cuando se construya (#19), igual que el pin de certificados.
- Temporizador de reenvío: "Reenviar código en 0:45"; al llegar a cero se activa el
  enlace "Reenviar código".
- Botón primario "Verificar", deshabilitado hasta completar los 6 dígitos.
- Enlace "Cambiar número" → vuelve a Registro con el resto de los campos ya completos.

### Estados — Verificación SMS

- **Código correcto**: otorga la insignia azul automáticamente (sin aprobación manual, ya
  definido en PRODUCT.md), navega a Home. Confirmación breve tipo toast: "¡Cuenta
  verificada! Ya tenés tu insignia azul."
- **Código incorrecto**: animación de error en las casillas, se limpian, foco vuelve a la
  primera. No cuenta como "agotado" hasta 5 intentos.
- **5 intentos fallidos**: bloquea "Verificar" 5 minutos, con el motivo explicado.
- **Código expirado** (>10 min): mensaje "Este código venció, pedí uno nuevo" + habilita
  reenvío inmediato.
- **El SMS no llega** tras reenviar 2 veces: enlace "¿No te llega? Contactar soporte" →
  [SUPPORT.md](../../SUPPORT.md).
- **Sin conexión**: si "Verificar" o "Reenviar" fallan por red, banner "Sin conexión" con
  "Reintentar"; los dígitos ya ingresados no se pierden.

## 4. Insignia azul

Se otorga automáticamente al validar el código SMS. Se muestra junto al nombre en Perfil
y en cualquier lugar donde aparezca el nombre de la persona (chats, grupos de caso).

## Accesibilidad

Aporta contexto a [issue #17](https://github.com/TomasPosada0626/PawFound/issues/17)
(que fija el estándar), no lo reemplaza:

- Todos los campos con label asociado real, no solo el placeholder del mockup.
- El ícono de "ojo" (mostrar/ocultar contraseña) necesita accessibilityLabel explícito.
- Cada casilla del código SMS con accessibilityLabel ("Dígito 1 de 6", etc.).
- Los dos íconos de modo claro/oscuro son botones (`accessibilityRole="button"`), cada uno
  con label propio ("Activar modo claro" / "Activar modo oscuro") y `accessibilityState`
  marcando cuál está activo — no un switch único, corregido tras la crítica de #11.
- **Código incorrecto en el SMS anuncia el error a lectores de pantalla** (región viva /
  `accessibilityLiveRegion`), no solo limpia las casillas en silencio — hallazgo de la
  persona Sam en la crítica de #11.
- El contraste del borde teal claro sobre blanco de los inputs se valida contra el
  estándar que fije #17.

## Estado

Revisado con `/impeccable critique` (25/40, banda "Aceptable"). Los 2 P0, 2 P1 y 2 P2
encontrados quedaron incorporados en este documento (modo exploración sin cuenta,
relación login social↔SMS↔insignia, autocompletado SMS, estados sin conexión, default de
"Recordar sesión", corrección del toggle claro/oscuro y anuncio de error accesible).
Listo para pasar a construcción (#18, #19).
