/** Estilos de Google Maps: claro suave (como los mockups) y oscuro de primera clase. */

export const lightMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#F1F4F3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4A5A6B" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#DCEFE3" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#FBEFD5" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#B9DEF0" }] },
];

export const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#15212D" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9DB0C0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0B1622" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#173A33" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#24364A" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#33495F" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0E2A3D" }] },
];
