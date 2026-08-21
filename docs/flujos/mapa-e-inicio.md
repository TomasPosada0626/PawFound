# Flujo: mapa e inicio

Especificación de flujo para [issue #12](https://github.com/TomasPosada0626/PawFound/issues/12).
Fuente visual: [`Diseño ideal/Home.png`](../../Diseño%20ideal/Home.png) y
[`Diseño ideal/Mapa.png`](../../Diseño%20ideal/Mapa.png) — el mockup manda si hay
conflicto con esta descripción.

## Corrección encontrada al escribir esta spec

Documentos anteriores (PRODUCT.md, algunas issues) decían "tema azul" para mascotas
encontradas. Los mockups reales (`Home.png`, `Mapa.png`) usan **teal** (el mismo verde
azulado de marca), no un azul separado. Ya corregido en PRODUCT.md, docs/accesibilidad.md
y la issue #24; el resto de menciones sueltas de "azul" para encontrada se corrigen a
medida que se toca cada issue, no en un barrido aparte.

## 1. Inicio (`Home.png`)

- Header: menú hamburguesa (izquierda), wordmark PawFound (centro), campana de
  notificaciones con badge de no-leídas (derecha).
- Saludo personalizado "¡Hola, [Nombre]!" con mensaje breve + foto de perfil.
- Tarjeta CTA "Reportar mascota" → Reportar (mismo destino que el botón `+` del nav).
- "Mascotas cerca de ti": carrusel horizontal de tarjetas (foto, badge Perdido/Encontrado
  con color **y** texto, nombre, raza/especie, distancia, tiempo transcurrido, corazón de
  favorito). Enlace "Ver mapa" → Mapa.
- "Nuestro impacto": 4 estadísticas (mascotas reunidas, reportes del mes, usuarios
  activos, % casos con final feliz).
- "Actividad reciente": feed de eventos propios (ej. "tu reporte fue compartido N veces"),
  enlace "Ver todas".
- Nav inferior: Inicio, Mapa, Reportar (+, botón central), Mensajes, Perfil.

### "Nuestro impacto" — dato real, no inventado

El mockup muestra números de ejemplo (128, 356, 2.480, 98%). No son datos reales ni un
compromiso de producto. Esta sección se alimenta de métricas reales agregadas del backend
(PRODUCT.md § Métricas de éxito) una vez que existan. Si al lanzar el número real es bajo
o cero, se define un estado alternativo (ocultar la sección, o un texto que no implique
una escala falsa) en vez de mostrar un cero desalentador — y nunca un número inventado
para parecer más establecidos de lo que la app es en ese momento.

## 2. Mapa (`Mapa.png`)

- Header: dos íconos de tema (sol/luna, igual que Login — ver docs/flujos/onboarding-login-registro.md), wordmark centro.
- Buscador "Busca mascotas, lugares o direcciones" + botón de filtros avanzados.
- Chips de filtro: Todas (activo por defecto) / Perdidas (punto rojo) / Encontradas
  (punto teal) / Filtros (abre panel avanzado — especie, distancia, fecha).
- Pines: foto de la mascota dentro de un marcador con borde de color (rojo/teal) y un
  ícono de huella pequeño. El punto azul del centro del mapa es la ubicación propia del
  usuario (con círculo de precisión estándar de mapas) — **no** es el "círculo de vida"
  de ninguna mascota; ese círculo solo existe en el detalle de una mascota específica
  (issue #13).
- Botones flotantes: "Capas" (cambiar estilo de mapa) y "Mi ubicación" (recentrar).
- Hoja inferior: "Mascotas cerca de ti" + "Ver lista", mismo estilo de tarjeta que Home.
- Nav inferior igual que Home, con "Mapa" activo.

## 3. Estados del mapa

- **Vacío** (sin mockup — diseñado acá): ningún pin cerca. Mensaje "No hay mascotas
  reportadas cerca. Probá ampliar el área de búsqueda." + ilustración simple + botón para
  ampliar el radio del buscador. No es un error, es un estado normal y esperable.
- **Pocos pines**: como en el mockup, sin agrupar.
- **Muchos pines / clustering** (sin mockup — diseñado acá): clusters estándar de mapa,
  círculo con el número de casos agrupados. El color del cluster refleja la mayoría
  (rojo si predominan perdidas, teal si predominan encontradas, o un tercer color neutro
  si está parejo) — nunca se mezcla en un color ambiguo sin indicar el conteo. Tocar un
  cluster hace zoom para desagruparlo, no navega directo a un detalle.

## 4. Transición a detalle de mascota

- Tocar un pin con una sola mascota, o una tarjeta del carrusel/lista → detalle de esa
  mascota directamente (issue #13).
- Tocar un cluster → zoom-in para desagrupar, no navega a ningún detalle.
- El corazón (♡) en una tarjeta es un toggle de favorito independiente; tocarlo no debe
  disparar también la navegación al detalle (área de toque separada del resto de la
  tarjeta).

## Accesibilidad

Contra [docs/accesibilidad.md](../accesibilidad.md):

- Los badges Perdido/Encontrado llevan color **y** texto (ya cumplido en el mockup) — el
  color nunca es el único portador del significado.
- Cada pin del mapa con `accessibilityLabel` describiendo mascota, estado y distancia
  ("Max, perro perdido, a 0.3 km"), no solo el ícono visual.
- Chips de filtro y tarjetas del carrusel con touch target ≥48×48dp.
- Un cluster de pines debe poder anunciarse a TalkBack con su conteo, no ser solo un
  número visual sin semántica.

## Referencias

- Diseño ideal/Home.png
- Diseño ideal/Mapa.png
- PRODUCT.md § Operating Context, § Métricas de éxito
- docs/accesibilidad.md

## Estado

Especificación completa. Esta issue no exige `/impeccable critique` en su checklist
original (a diferencia de #11); queda disponible para pedirla más adelante si se decide.
