/**
 * Estilos de Google Maps (Android). Claro: calles blancas sobre gris suave, parques verdes,
 * agua celeste y nombres de barrios visibles, como el mockup de Mapa. Oscuro: azul noche con
 * el mismo orden visual. Los negocios y el transporte se ocultan para que resalten los pines
 * de las mascotas (rojo: perdida; aguamarina: encontrada).
 */

export const lightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#F2F4F5" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5E6B78" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FFFFFF" }, { weight: 3 }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#7B8794" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#EDF0F2" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#D3EDD9" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#3E8E5A" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E0E5E9" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#FFE7B3" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#F4D287" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#A6DBF1" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3A86AE" }] },
];

export const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#13202C" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9DB0C0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0A1520" }, { weight: 3 }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#7F94A6" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#143A33" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#22364A" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1A2B3B" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3A4F66" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0B3550" }] },
];
