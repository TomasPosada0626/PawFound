# Hallazgos: entrevistas con dueños, refugios y veterinarias

Consolida los hallazgos de campo para [issue #7](https://github.com/TomasPosada0626/PawFound/issues/7)
y [issue #8](https://github.com/TomasPosada0626/PawFound/issues/8), siguiendo
[plantilla-sintesis.md](plantilla-sintesis.md).

> Nombres anonimizados a rol + inicial antes de publicar en el repositorio público —
> no se confirmó consentimiento explícito de las personas entrevistadas para publicar su
> nombre completo en un issue de GitHub indexado y buscable de forma permanente.

## Quiénes participaron

Entrevistas cortas informales realizadas por el fundador con 6 personas en Colombia:
2 médicos/as veterinarios/as, 1 rescatista independiente, 1 administradora de refugio,
2 dueñas de mascota.

## Hallazgos por entrevista

**Veterinaria M.G. (egresada, Universidad CES)**: recibe consultas frecuentes sobre
mascotas perdidas; los reportes llegan por WhatsApp, Instagram y Facebook sin
coordinación entre sí, lo que dificulta el seguimiento. Valoraría poder publicar un
reporte una sola vez desde la clínica y que llegue automáticamente a personas cercanas
por ubicación.

**Veterinario A.D. (egresado, Universidad CES)**: cuando llega una mascota sin placa ni
microchip, toman fotos y esperan a que alguien la reclame; el dueño suele haber publicado
en redes, pero esa información nunca llega a la clínica. Un mapa de mascotas encontradas
reduciría tiempos.

**Rescatista S.J. (independiente)**: las publicaciones pierden visibilidad rápido y
recibe muchos mensajes repitiendo la misma pregunta. Alertas geolocalizadas movilizarían
más gente en las primeras horas, que son las más importantes. Usaría primero el mapa de
avistamientos y las notificaciones por ubicación.

**Administradora de refugio M.C.**: antes de iniciar un proceso de adopción intentan
localizar al dueño original por publicaciones y llamadas; no existe una base única para
consultar si alguien ya reportó esa mascota como perdida. Una plataforma compartida entre
refugios, veterinarias y ciudadanía reduciría trabajo duplicado.

**Dueña de mascota P.R.**: ante una pérdida, publicaría de inmediato en redes y pediría
ayuda a su círculo cercano. Su mayor preocupación es no saber si alguien ya vio a su
mascota cerca de donde desapareció. Usaría PawFound especialmente por las notificaciones
de avistamientos cercanos.

**Dueña de mascota M.T.**: las primeras horas son determinantes; una alerta inmediata a
vecinos y gente cercana podría movilizar ayuda real. Prefiere una app especializada a
publicar repetidamente en varias redes.

## Patrones que aparecieron en varias entrevistas

- La información sobre mascotas perdidas está fragmentada entre WhatsApp, Facebook,
  Instagram y grupos comunitarios — mencionado por las 6 personas.
- Las primeras horas después de la pérdida son las que más importan (rescatista,
  ambas dueñas, ambos veterinarios).
- Veterinarias y refugios hacen búsqueda manual (llamadas, revisar publicaciones) que
  consume tiempo y no está centralizada.
- Dueños valoran recibir alertas en tiempo real más que depender del alcance orgánico de
  sus propias publicaciones.

## Contradice o abre algo que ya asumimos en PRODUCT.md

**Sí, uno real.** PRODUCT.md dice hoy: *"refugios participan como validadores del MVP, no
como un tipo de cuenta con permisos propios."* Tres de las seis entrevistas (veterinaria
M.G., veterinario A.D., administradora M.C.) señalan específicamente la utilidad de
**publicar una sola vez desde una institución** y que eso llegue a más gente — una
necesidad distinta a la de un dueño individual reportando su propia mascota. No es
concluyente con 3 menciones sobre una muestra de 6, pero es la primera señal real que
apunta a que un rol de cuenta institucional (veterinaria/refugio) podría valer la pena,
en lugar de forzarlos al mismo modelo que una persona particular.

**Decisión**: no se expande el alcance del MVP ahora mismo solo con esta señal — se deja
registrada como candidata a revisar después del piloto (issue #48), cuando haya más
datos, en vez de comprometer trabajo adicional de Fase 3 sin validarlo más.

## Decisiones que esto destraba

- [x] Confirmar o ajustar la regla del círculo de vida (#10) — sin contradicción directa;
      las entrevistas refuerzan la urgencia de las primeras horas, consistente con los
      perfiles ya definidos.
- [ ] Rol de cuenta institucional para veterinarias/refugios — señal real encontrada,
      **no resuelto**, candidato a revisar post-piloto.

## Qué queda sin resolver

- Con una muestra de 6 no alcanza para decidir el rol institucional con confianza —
  necesitaría una ronda más grande, específicamente con más veterinarias/refugios.
- Ninguna entrevista tocó directamente la sensibilidad de compartir ubicación exacta
  (issue #46) ni el proceso de verificación por SMS — quedan sin validar con datos reales
  todavía.
- Una idea mencionada (comparar fotos entre reportes activos automáticamente) implica
  reconocimiento/matching por imagen, que quedó explícitamente fuera de alcance para v1
  (ver docs/ARCHITECTURE.md § Fuera de alcance en v1) — no se agrega solo por esta señal.
