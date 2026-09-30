import { get, guardarToken, leerToken, panelDe, post, textoError } from "./api.js";

const pagina = document.body.dataset.page;
const formulario = document.querySelector("#auth-form");
const error = document.querySelector("#auth-error");
const boton = document.querySelector("#auth-submit");

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
    password: document.querySelector("#password").value
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

/* Botones de las cuentas de ejemplo: rellenan el formulario para probar. */
for (const botonDemo of document.querySelectorAll("[data-demo-email]")) {
  botonDemo.addEventListener("click", () => {
    document.querySelector("#email").value = botonDemo.dataset.demoEmail;
    document.querySelector("#password").value = botonDemo.dataset.demoPassword;
    limpiarError();
    document.querySelector("#auth-submit").focus();
  });
}
