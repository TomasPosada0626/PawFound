import assert from "node:assert/strict";
import { test } from "node:test";

import { escaparHtml, hace, idValido, textosDelCaso } from "./caso.js";

const ahora = new Date("2026-11-03T15:00:00Z");
const caso = (extra = {}) => ({
  id: "max",
  kind: "lost",
  state: "active",
  species: "dog",
  sex: "male",
  size: "large",
  zone: "Laureles",
  lastSeenAt: "2026-11-03T13:00:00Z",
  description: "Collar rojo",
  photos: ["https://api.x/v1/media/med_1"],
  ...extra,
});

test("solo acepta ids seguros", () => {
  assert.equal(idValido("pet_123-ab"), true);
  assert.equal(idValido("../../v1/me"), false);
  assert.equal(idValido("<script>"), false);
  assert.equal(idValido(""), false);
});

test("dice hace cuánto", () => {
  assert.equal(hace("2026-11-03T14:59:40Z", ahora), "hace un momento");
  assert.equal(hace("2026-11-03T14:59:00Z", ahora), "hace 1 minuto");
  assert.equal(hace("2026-11-03T14:20:00Z", ahora), "hace 40 minutos");
  assert.equal(hace("2026-11-03T13:00:00Z", ahora), "hace 2 horas");
  assert.equal(hace("2026-11-01T15:00:00Z", ahora), "hace 2 días");
});

test("perdida con nombre: título, texto, datos y foto para WhatsApp", () => {
  const t = textosDelCaso(caso({ name: "Max" }), ahora);
  assert.equal(t.estado, "perdida");
  assert.equal(t.titulo, "¡Ayúdanos a encontrar a Max!");
  assert.equal(t.texto, "Lo vieron por última vez en Laureles, hace 2 horas. Si lo ves, avísale a la familia.");
  assert.deepEqual(t.datos, ["Perro", "Macho", "Grande"]);
  assert.equal(t.insignia, "Perdido");
  assert.equal(t.miniatura, "https://api.x/v1/media/med_1?size=thumb");
  assert.equal(t.telefono, null);
});

test("sin nombre usa perrito, gatica… como la app", () => {
  assert.equal(textosDelCaso(caso(), ahora).titulo, "¡Ayúdanos a encontrar al perrito perdido!");
  assert.equal(
    textosDelCaso(caso({ kind: "found", species: "cat", sex: "female" }), ahora).titulo,
    "¿Conoces a la gatica encontrada?",
  );
  const encontrada = textosDelCaso(caso({ kind: "found", species: "dog", sex: "female" }), ahora);
  assert.equal(encontrada.texto, "La encontraron en Laureles, hace 2 horas. Si sabes de quién es, avísale a quien la reportó.");
  assert.equal(encontrada.insignia, "Encontrada");
  assert.equal(textosDelCaso(caso({ species: "other", sex: "unknown" }), ahora).titulo, "¡Ayúdanos a encontrar a la mascota perdida!");
});

test("celular del afiche: llamar y WhatsApp; nunca en un caso cerrado", () => {
  const t = textosDelCaso(caso({ name: "Max", contactPhone: "+573001234567" }), ahora);
  assert.equal(t.telefono, "+573001234567");
  assert.match(t.whatsapp, /^https:\/\/wa\.me\/573001234567\?text=/);
  assert.equal(textosDelCaso(caso({ contactPhone: "3001234567" }), ahora).telefono, null);
  assert.equal(textosDelCaso(caso({ state: "reunited", contactPhone: "+573001234567" }), ahora).telefono, null);
});

test("en casa, archivado o retirado por moderación", () => {
  assert.equal(textosDelCaso(caso({ name: "Luna", sex: "female", state: "reunited" }), ahora).titulo, "¡Luna ya está en casa!");
  assert.equal(textosDelCaso(caso({ state: "reunited" }), ahora).titulo, "¡El perrito perdido ya está en casa!");
  assert.equal(textosDelCaso(caso({ state: "archived" }), ahora).estado, "no-disponible");
  assert.equal(textosDelCaso(caso({ moderationRemoved: true }), ahora).estado, "no-disponible");
});

test("la descripción se recorta y el HTML se escapa", () => {
  assert.equal(textosDelCaso(caso({ description: "x".repeat(900) }), ahora).descripcion.length, 400);
  assert.equal(escaparHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
});
