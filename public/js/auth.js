import { get, guardarNegocio, guardarToken, leerToken, panelDe, post, textoError } from "./api.js";

const pagina = document.body.dataset.page;
const formulario = document.querySelector("#auth-form");
const error = document.querySelector("#auth-error");
const boton = document.querySelector("#auth-submit");

// El negocio sale de la URL: /b/:slug/login o /b/:slug/registro. Sólo el
// superadmin entra por /login (sin slug), y su token no lleva negocio.
const coincidencia = window.location.pathname.match(/^\/b\/([^/]+)\//);
const negocio = coincidencia ? coincidencia[1] : "";

// Los enlaces entre login y registro mantienen al usuario dentro de su negocio.
if (negocio) {
  for (const enlace of document.querySelectorAll(".auth-switch a")) {
    const destino = enlace.getAttribute("href") || "";
    if (destino === "/login") {
      enlace.href = `/b/${negocio}/login`;
    } else if (destino === "/registro") {
      enlace.href = `/b/${negocio}/registro`;
    }
  }
}

/* Si ya hay sesión, /login y /registro no tienen sentido: se salta al panel.
   La comprobación sólo se lanza si hay token; sin él, /me responde 401 y la
   redirección devolvería el navegador a esta misma página en bucle. */
if (leerToken()) {
  get("/api/auth/me")
    .then((sesion) => window.location.replace(panelDe(sesion.user.role)))
    .catch(() => {
      // Token caducado: la capa de API ya lo borra.
    });
}

// Pintar el nombre del negocio en la cabecera, si la URL lo trae.
if (negocio) {
  get(`/api/negocios/${encodeURIComponent(negocio)}`)
    .then((datos) => {
      const marca = document.querySelector(".brand strong");
      if (marca) {
        marca.textContent = datos.negocio.nombre;
      }
      const titulo = document.querySelector("h1");
      if (titulo && titulo.dataset.negocio === "si") {
        titulo.textContent = datos.negocio.nombre;
      }
    })
    // Un slug que no existe, o una empresa desactivada, no llegan a pintar nada.
    // Se avisa aquí: si no, el visitante ve un formulario normal que siempre
    // fallaría con "no existe", y no sabría que se equivocó en la dirección.
    .catch(() => {
      const subtitulo = document.querySelector("#login-subtitulo");
      if (subtitulo) {
        subtitulo.textContent = `No encontramos ningún negocio con el identificador "${negocio}". Revísalo o vuelve al inicio.`;
      }
      if (boton) {
        boton.disabled = true;
      }
    });
} else if (pagina === "login") {
  // /login sin slug es la puerta de la plataforma: sólo entra el
  // superadministrador. Las cuentas del seed no valen aquí, así que se cambian
  // los botones de ejemplo en vez de dejar unos que no funcionan.
  const subtitulo = document.querySelector("#login-subtitulo");
  if (subtitulo) {
    subtitulo.textContent =
      "Acceso del equipo de la plataforma. Los clientes y la administración de cada empresa entran por su propia dirección.";
  }
  const lista = document.querySelector("#demo .demo-accounts");
  if (lista) {
    lista.innerHTML = `
      <button type="button" data-demo-email="super@plataforma.com" data-demo-password="Super1234">
        <span>Plataforma</span><span class="muted">super@plataforma.com</span>
      </button>`;
  }
}

if (pagina === "registro" && !negocio) {
  mostrarError("Para crear una cuenta entra por el enlace de tu negocio (/b/tu-negocio/registro).");
  if (boton) {
    boton.disabled = true;
  }
}

function mostrarError(texto) {
  error.textContent = texto;
  error.hidden = false;
}

function limpiarError() {
  error.textContent = "";
  error.hidden = true;
}

function valor(id) {
  const campo = document.querySelector(`#${id}`);
  return campo ? campo.value.trim() : "";
}

function cuerpo() {
  const comun = {
    email: valor("email"),
    password: document.querySelector("#password").value,
    negocio
  };

  if (pagina === "registro") {
    return {
      ...comun,
      nombre: valor("nombre"),
      documento: valor("documento"),
      fechaNacimiento: valor("fechaNacimiento"),
      telefono: valor("telefono"),
      direccion: valor("direccion"),
      confirmPassword: document.querySelector("#confirmPassword").value
    };
  }

  return comun;
}

async function enviar(evento) {
  evento.preventDefault();
  limpiarError();

  if (!formulario.reportValidity()) {
    return;
  }

  boton.disabled = true;
  boton.textContent = pagina === "registro" ? "Creando cuenta…" : "Comprobando…";

  try {
    const ruta = pagina === "registro" ? "/api/auth/register" : "/api/auth/login";
    const sesion = await post(ruta, cuerpo());
    guardarToken(sesion.token);
    guardarNegocio(sesion.negocio ? sesion.negocio.slug : negocio);
    window.location.assign(panelDe(sesion.user.role));
  } catch (problema) {
    mostrarError(textoError(problema));
    boton.disabled = false;
    boton.textContent = pagina === "registro" ? "Crear cuenta" : "Entrar";
  }
}

formulario.addEventListener("submit", (evento) => {
  void enviar(evento);
});

/* Botones de las cuentas de ejemplo: rellenan el formulario para probar.
   Se engancha UN listener en el documento en vez de uno por botón, porque el
   bloque se reescribe más arriba cuando la puerta es la de la plataforma: los
   botones nuevos se crearían después de recorrer el DOM y no quedarían
   escuchando. La delegación los pilla igual. */
document.addEventListener("click", (evento) => {
  const botonDemo = evento.target.closest("[data-demo-email]");
  if (!botonDemo) {
    return;
  }
  evento.preventDefault();
  document.querySelector("#email").value = botonDemo.dataset.demoEmail;
  document.querySelector("#password").value = botonDemo.dataset.demoPassword;
  limpiarError();
  if (boton) {
    boton.focus();
  }
});
