// Solo ids con letras, números, _ y - (nunca se inyecta texto de la URL en la página).
const id = (location.pathname.split("/mascota/")[1] || "").split("/")[0];
if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
  document.getElementById("open-app").href = "pawfound://pet/" + id;
}
