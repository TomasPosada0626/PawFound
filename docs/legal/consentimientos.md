# Consentimientos

> Pendiente de revisión legal en Colombia. Estos son los textos que muestra la app; el marco legal
> completo está en [tratamiento-de-datos.md](tratamiento-de-datos.md) y en
> [politica-de-privacidad.md](politica-de-privacidad.md).

Versión de estos textos: 0.2 (`ConsentTextVersion` en `apps/api/internal/domain/rules.go`). Cada
consentimiento se guarda en la tabla `consents` con su tipo, si se dio o se retiró, la fecha y la
versión vigente. Si cambia un texto de este documento, se sube esa versión en el mismo PR.

## Términos y política de privacidad (al registrarse) — `terms`

Casillas obligatorias para crear la cuenta:

“Acepto los Términos y Condiciones y la Política de Privacidad.”

“Confirmo que tengo 18 años o más.”

## Ubicación aproximada para las alertas — `location`, `alert_zone`

Se muestra justo antes de pedir el permiso, en la pantalla «Activa tus alertas»:

“Usamos tu ubicación aproximada, también con la app cerrada, solo para avisarte de mascotas
perdidas cerca.”

## Notificaciones — `push`, `angel_alerts`

“Deseo recibir notificaciones de mascotas perdidas cercanas. Entiendo que son avisos de la
comunidad, no alertas gubernamentales ni mensajes SMS, y que puedo desactivarlos en
cualquier momento.”

En Ajustes, la Alerta Ángel se activa por separado: “Máximo 5 alertas al día y una sola por caso,
para no saturarte.”

## Ubicación en un mensaje directo (en cada envío)

Se muestra en la pantalla «Compartir ubicación» antes de enviar. Enviar es la autorización y
aplica solo a ese mensaje:

“Solo [nombre] la verá. Se envía este punto una sola vez: no es en vivo. Puedes dejar de
compartirla cuando quieras. También deja de verse al cerrar este chat o el caso.”

## Políticas de PawFamily (al entrar por primera vez) — `adoption_terms`

Pantalla «Adopción responsable»:

- “PawFamily es el lugar de PawFound para encontrarle hogar a mascotas abandonadas o de refugios.”
- “La adopción es 100 % gratuita. Nadie puede pedir ni recibir dinero, ni siquiera «para la vacuna»
  o «para el transporte».”
- “Los datos que ingreses para adoptar o para dar en adopción deben ser verdaderos.”
- “Si alguien te pide dinero, repórtalo: moderación lo revisa y puede vetar la cuenta de PawFound.”
- “Quien publica decide a quién entregar la mascota. Al aceptar una solicitud se abre un chat para
  coordinar.”

Casilla: “Acepto las políticas de adopción responsable”.

## Principios

Los consentimientos son granulares, no vienen preseleccionados, se pueden revocar y quedan
registrados con fecha y versión del texto. Rechazar un permiso no impide navegar el contenido
público. Retirar las notificaciones o la ubicación se registra como revocación (por ejemplo, al
quedarse la cuenta sin celulares con sesión abierta).
