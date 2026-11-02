(() => {
  const form = document.getElementById("reset-form");
  const done = document.getElementById("done");
  const password = document.getElementById("password");
  const confirm = document.getElementById("confirm");
  const message = document.getElementById("message");
  const submit = document.getElementById("submit");
  const toggle = document.getElementById("toggle");
  // El token se lee y se quita de la barra de direcciones (no queda en el historial).
  const token = new URLSearchParams(location.search).get("token") || "";
  if (token) history.replaceState(null, "", location.pathname);

  const say = (text, kind) => {
    message.textContent = text;
    message.className = "message " + (kind || "");
  };
  const rules = {
    length: (v) => v.length >= 8,
    upper: (v) => /\p{Lu}/u.test(v),
    lower: (v) => /\p{Ll}/u.test(v),
    number: (v) => /\p{Nd}/u.test(v),
  };
  const check = () => {
    let ok = true;
    for (const li of document.querySelectorAll("#rules li")) {
      const pass = rules[li.dataset.rule](password.value);
      li.classList.toggle("ok", pass);
      ok = ok && pass;
    }
    return ok;
  };
  password.addEventListener("input", check);
  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.textContent = show ? "Ocultar" : "Ver";
    toggle.setAttribute("aria-pressed", String(show));
  });

  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    say("Este enlace no es válido. Pide uno nuevo desde la app con «¿Olvidaste tu contraseña?».", "error");
    submit.disabled = true;
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!check()) return say("La contraseña todavía no cumple todos los requisitos.", "error");
    if (password.value !== confirm.value) return say("Las contraseñas no coinciden.", "error");
    submit.disabled = true;
    say("Guardando… si el servidor estaba dormido puede tardar hasta un minuto.", "info");
    try {
      const res = await fetch(form.dataset.api + "/v1/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: password.value }),
      });
      if (res.ok) {
        form.hidden = true;
        done.hidden = false;
        return;
      }
      if (res.status === 410) say("El enlace venció o ya se usó. Pide uno nuevo desde la app.", "error");
      else if (res.status === 422) say("La contraseña no cumple los requisitos.", "error");
      else if (res.status === 429) say("Demasiados intentos. Espera un rato e inténtalo de nuevo.", "error");
      else say("No pudimos guardar la contraseña. Inténtalo de nuevo.", "error");
    } catch {
      say("No pudimos conectar. Revisa tu internet e inténtalo de nuevo.", "error");
    }
    submit.disabled = false;
  });
})();
