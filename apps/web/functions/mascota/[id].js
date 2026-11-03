// Página pública de un caso con sus datos reales y la vista previa de WhatsApp (foto, nombre y
// zona). Toma la plantilla estática /mascota/ y la completa con HTMLRewriter. Si la API no
// responde, se entrega la plantilla tal cual: un aviso genérico con el botón para abrir la app.
import { API_DEFECTO, escaparHtml, idValido, textosDelCaso, textosNoDisponible } from "../../lib/caso.js";

const contenido = (valor) => ({
  element(e) {
    e.setAttribute("content", valor);
  },
});

async function buscarCaso(api, id) {
  try {
    const res = await fetch(`${api}/v1/pets/${id}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (res.status === 404) return { noDisponible: true };
    if (!res.ok) return {};
    return { pet: await res.json() };
  } catch {
    return {};
  }
}

export async function onRequestGet({ request, env, params }) {
  const plantilla = await env.ASSETS.fetch(new URL("/mascota/", request.url));
  const id = String(params.id ?? "");
  if (!idValido(id) || !plantilla.ok) return plantilla;

  const api = String(env.API_URL || API_DEFECTO).replace(/\/+$/, "");
  const { pet, noDisponible } = await buscarCaso(api, id);
  if (!pet && !noDisponible) return plantilla;
  const t = pet ? textosDelCaso(pet, new Date()) : textosNoDisponible();

  const url = new URL(request.url);
  url.search = "";
  const html = new HTMLRewriter()
    .on("title", {
      element(e) {
        e.setInnerContent(`${t.titulo} · PawFound`);
      },
    })
    .on('meta[name="description"]', contenido(t.texto))
    .on('meta[property="og:title"]', contenido(t.titulo))
    .on('meta[property="og:description"]', contenido(t.texto))
    .on('meta[property="og:url"]', contenido(url.toString()))
    .on('link[rel="canonical"]', {
      element(e) {
        e.setAttribute("href", url.toString());
      },
    })
    .on('meta[property="og:image"]', t.miniatura ? contenido(t.miniatura) : {})
    .on("head", {
      element(e) {
        if (t.miniatura) e.append('<meta name="twitter:card" content="summary_large_image" />', { html: true });
      },
    })
    .on("#caso", {
      element(e) {
        e.setAttribute("data-estado", t.estado);
      },
    })
    .on("#caso-foto", {
      element(e) {
        if (!t.foto) return;
        e.setAttribute("src", t.foto);
        e.setAttribute("alt", `Foto: ${t.titulo}`);
        e.removeAttribute("hidden");
      },
    })
    .on("#caso-sin-foto", {
      element(e) {
        if (t.foto) e.remove();
      },
    })
    .on("#caso-estado", {
      element(e) {
        if (!t.insignia) return;
        e.setInnerContent(t.insignia);
        e.removeAttribute("hidden");
      },
    })
    .on("#caso-titulo", {
      element(e) {
        e.setInnerContent(t.titulo);
      },
    })
    .on("#caso-texto", {
      element(e) {
        e.setInnerContent(t.texto);
      },
    })
    .on("#caso-datos", {
      element(e) {
        if (!t.datos.length) return;
        e.setInnerContent(t.datos.map((d) => `<li>${escaparHtml(d)}</li>`).join(""), { html: true });
        e.removeAttribute("hidden");
      },
    })
    .on("#caso-descripcion", {
      element(e) {
        if (!t.descripcion) return;
        e.setInnerContent(t.descripcion);
        e.removeAttribute("hidden");
      },
    })
    .on("#caso-llamar", {
      element(e) {
        if (!t.telefono) return;
        e.setAttribute("href", `tel:${t.telefono}`);
        e.removeAttribute("hidden");
      },
    })
    .on("#caso-whatsapp", {
      element(e) {
        if (!t.whatsapp) return;
        e.setAttribute("href", t.whatsapp);
        e.removeAttribute("hidden");
      },
    })
    .on("#open-app", {
      element(e) {
        if (t.estado === "no-disponible") e.remove();
      },
    })
    .transform(plantilla);

  const headers = new Headers(html.headers);
  headers.set("cache-control", "public, max-age=60");
  return new Response(html.body, { status: noDisponible ? 404 : 200, headers });
}
