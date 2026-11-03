// Textos de la página pública de un caso (functions/mascota/[id].js). Mismas reglas que la app:
// sin nombre se dice "perrito", "gatica"... (apps/mobile/src/features/petNames.ts).

export const API_DEFECTO = "https://pawfound-api.onrender.com";

const NOMBRES = { dog: ["perrito", "perrita"], cat: ["gatico", "gatica"] };
const ESPECIE = { dog: "Perro", cat: "Gato", other: "Otra mascota" };
const SEXO = { male: "Macho", female: "Hembra" };
const TAMANO = { small: "Pequeño", medium: "Mediano", large: "Grande" };

/** Solo ids con letras, números, _ y -: nunca se usa texto libre de la URL. */
export function idValido(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** "hace 5 minutos", "hace 2 horas", "hace 3 días". */
export function hace(fecha, ahora) {
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(fecha).getTime()) / 60_000));
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return minutos === 1 ? "hace 1 minuto" : `hace ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

function femenino(pet) {
  return pet.species === "other" || pet.sex === "female";
}

/** "la perrita perdida", "el gatico encontrado", "la mascota perdida". */
function laMascota(pet) {
  const f = femenino(pet);
  const nombre = pet.species === "other" ? "mascota" : NOMBRES[pet.species][f ? 1 : 0];
  const estado = pet.kind === "found" ? (f ? "encontrada" : "encontrado") : f ? "perdida" : "perdido";
  return `${f ? "la" : "el"} ${nombre} ${estado}`;
}

const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "a Luna", "a la perrita perdida", "al perrito perdido". */
const aLaMascota = (pet) => (pet.name ? `a ${pet.name}` : `a ${laMascota(pet)}`.replace(/^a el /, "al "));

/** Caso cerrado, retirado o que no existe. */
export function textosNoDisponible() {
  return {
    estado: "no-disponible",
    titulo: "Este caso ya no está disponible",
    texto: "La familia lo cerró o lo eliminó. Gracias por querer ayudar.",
    datos: [],
  };
}

/** Todo lo que la página muestra de un caso, ya en texto. */
export function textosDelCaso(pet, ahora) {
  if (!pet || pet.moderationRemoved) return textosNoDisponible();
  const f = femenino(pet);
  const lo = f ? "la" : "lo";
  const nombre = pet.name || mayuscula(laMascota(pet));
  const zona = pet.zone ? ` en ${pet.zone}` : "";
  const cuando = pet.lastSeenAt ? `, ${hace(pet.lastSeenAt, ahora)}` : "";
  let estado;
  let titulo;
  let texto;
  let insignia;
  if (pet.state === "reunited") {
    estado = "en-casa";
    titulo = `¡${nombre} ya está en casa!`;
    texto = "Gracias a todas las personas que ayudaron a buscar.";
    insignia = "¡En casa!";
  } else if (pet.state !== "active") {
    return textosNoDisponible();
  } else if (pet.kind === "found") {
    estado = "encontrada";
    titulo = `¿Conoces ${aLaMascota(pet)}?`;
    texto = `${mayuscula(lo)} encontraron${zona}${cuando}. Si sabes de quién es, avísale a quien ${lo} reportó.`;
    insignia = f ? "Encontrada" : "Encontrado";
  } else {
    estado = "perdida";
    titulo = `¡Ayúdanos a encontrar ${aLaMascota(pet)}!`;
    texto = `${mayuscula(lo)} vieron por última vez${zona}${cuando}. Si ${lo} ves, avísale a la familia.`;
    insignia = f ? "Perdida" : "Perdido";
  }
  const datos = [ESPECIE[pet.species], SEXO[pet.sex], TAMANO[pet.size], pet.breed, pet.color].filter(Boolean);
  const foto = Array.isArray(pet.photos) && typeof pet.photos[0] === "string" ? pet.photos[0] : null;
  const telefono = estado !== "en-casa" && /^\+57\d{10}$/.test(pet.contactPhone || "") ? pet.contactPhone : null;
  return {
    estado,
    titulo,
    texto,
    insignia,
    datos,
    descripcion: typeof pet.description === "string" ? pet.description.trim().slice(0, 400) : "",
    foto,
    miniatura: foto ? `${foto}${foto.includes("?") ? "&" : "?"}size=thumb` : null,
    telefono,
    whatsapp: telefono
      ? `https://wa.me/${telefono.slice(1)}?text=${encodeURIComponent(`Hola, vi en PawFound el caso de ${pet.name || laMascota(pet)}.`)}`
      : null,
  };
}

/** Escapa texto para meterlo como HTML. */
export function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
