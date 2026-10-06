/**
 * Perfil del cliente: consulta y edita sus datos permitidos, y cambia su
 * contraseña. El rol y el estado de la cuenta no se envían nunca: el servidor los
 * rechaza, y aquí ni siquiera existen como campos.
 */
import {
  claimsDelToken,
  conectarSalir,
  datosDe,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  post,
  put,
  toast,
  textoError
} from "../api.js";
import { montarCabecera } from "../ui.js";

const sesion = await exigirSesion("CLIENT");
montarCabecera(sesion);
conectarSalir();

const formulario = document.querySelector("#perfil-form");
const error = document.querySelector("#perfil-error");
const mensaje = document.querySelector("#perfil-message");

let ficha = null;

function pintar(cliente) {
  ficha = cliente;
  formulario.elements.namedItem("nombre").value = cliente.nombre || "";
  formulario.elements.namedItem("documento").value = cliente.documento || "";
  formulario.elements.namedItem("fechaNacimiento").value = cliente.fechaNacimiento || "";
  formulario.elements.namedItem("email").value = sesion.user.email || "";
  formulario.elements.namedItem("telefono").value = cliente.telefono || "";
  formulario.elements.namedItem("direccion").value = cliente.direccion || "";
}

function pintarCuenta(cliente) {
  document.querySelector("#cuenta-rol").textContent = "Cliente";
  document.querySelector("#cuenta-estado").textContent = sesion.user.activo ? "Activa" : "Inactiva";
  document.querySelector("#cuenta-citas").textContent = String(sesion.citas ?? 0);
  document.querySelector("#cuenta-alta").textContent = fecha(cliente.createdAt);
  document.querySelector("#cuenta-acceso").textContent = fechaHora(sesion.user.ultimoAcceso);

  const claims = claimsDelToken();
  document.querySelector("#cuenta-sesion").textContent = claims?.exp
    ? fechaHora(new Date(claims.exp * 1000))
    : "—";
}

async function cargar() {
  try {
    const { cliente } = await get("/api/clients/me");
    pintar(cliente);
    pintarCuenta(cliente);
  } catch (error) {
    toast(textoError(error), true);
  }
}

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  error.hidden = true;
  mensaje.textContent = "";
  if (!formulario.reportValidity()) {
    return;
  }

  const datos = datosDe(formulario);
  const boton = document.querySelector("#perfil-guardar");
  boton.disabled = true;

  try {
    const respuesta = await put("/api/clients/me", {
      nombre: datos.nombre,
      documento: datos.documento,
      fechaNacimiento: datos.fechaNacimiento,
      email: datos.email,
      telefono: datos.telefono || null,
      direccion: datos.direccion || null
    });
    pintar(respuesta.cliente);
    mensaje.textContent = `Perfil actualizado (${fechaHora(respuesta.cliente.updatedAt)}).`;
    toast("Perfil guardado.");
  } catch (problema) {
    error.textContent = textoError(problema);
    error.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

document.querySelector("#perfil-descartar").addEventListener("click", () => {
  if (ficha) {
    pintar(ficha);
  }
  error.hidden = true;
  mensaje.textContent = "";
});

/* ---------------- Contraseña ---------------- */

const dialogoPassword = document.querySelector("#password-dialog");
const formularioPassword = document.querySelector("#password-form");
const errorPassword = document.querySelector("#password-error");

document.querySelector("#abrir-password").addEventListener("click", () => {
  formularioPassword.reset();
  errorPassword.hidden = true;
  dialogoPassword.showModal();
});

document.querySelector("#close-password").addEventListener("click", () => dialogoPassword.close());
document.querySelector("#cancel-password").addEventListener("click", () => dialogoPassword.close());

formularioPassword.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorPassword.hidden = true;
  if (!formularioPassword.reportValidity()) {
    return;
  }

  const datos = datosDe(formularioPassword);
  try {
    await post("/api/auth/password", {
      passwordActual: datos.passwordActual,
      passwordNueva: datos.passwordNueva,
      confirmPassword: datos.confirmPassword
    });
    dialogoPassword.close();
    toast("Contraseña actualizada.");
  } catch (problema) {
    errorPassword.textContent = textoError(problema);
    errorPassword.hidden = false;
  }
});

await cargar();
