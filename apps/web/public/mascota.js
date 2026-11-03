// Solo ids con letras, números, _ y - (nunca se inyecta texto de la URL en la página).
const id = (location.pathname.split("/mascota/")[1] || "").split("/")[0];
const abrir = document.getElementById("open-app");
if (abrir && /^[A-Za-z0-9_-]{1,64}$/.test(id)) {
  abrir.href = "pawfound://pet/" + id;
}
// Compartir con el menú del celular, donde existe.
const compartir = document.getElementById("caso-compartir");
if (compartir && navigator.share) {
  compartir.hidden = false;
  compartir.addEventListener("click", () => {
    navigator.share({ title: document.title, url: location.href }).catch(() => {});
  });
}
