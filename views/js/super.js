import { conectarSalir, esc, exigirSesion, get, patch, post, textoError, toast } from "./api.js";

const filas = document.querySelector("#tabla-negocios tbody");
const errorLista = document.querySelector("#lista-error");
const errorForm = document.querySelector("#form-error");
const form = document.querySelector("#negocio-form");

async function cargar() {
  try {
    const { items } = await get("/api/super/negocios");
    filas.innerHTML = items
      .map(
        (negocio) => `
      <tr>
        <td>${esc(negocio.nombre)}</td>
        <td><a href="/b/${esc(negocio.slug)}/login">/b/${esc(negocio.slug)}/login</a></td>
        <td>${negocio.activo ? "Activo" : "Desactivado"}</td>
        <td>${negocio.usuarios}</td>
        <td>${negocio.clientes}</td>
        <td>${negocio.citas}</td>
        <td>${
          // Quién administra la empresa. Es lo primero que hace falta cuando una
          // empresa se queda sin acceso, así que el correo va a la vista y no
          // escondido en un detalle.
          negocio.admins.length === 0
            ? '<span class="status-pill status-rejected">Sin admins</span>'
            : negocio.admins
                .map(
                  (admin) =>
                    `<div>${esc(admin.nombre)}<br><span class="muted">${esc(admin.email)}${
                      admin.activo ? "" : " · desactivado"
                    }</span></div>`
                )
                .join("")
        }</td>
        <td>
          <!-- Desactivar cierra las puertas de la empresa; no borra nada, así
               que se puede volver a activar y conserva todos sus datos. -->
          <button class="button button-quiet button-sm" data-activo="${negocio.activo ? "false" : "true"}" data-id="${negocio.id}">
            ${negocio.activo ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>`
      )
      .join("");
  } catch (problema) {
    errorLista.textContent = textoError(problema);
    errorLista.hidden = false;
  }
}

filas.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("button[data-id]");
  if (!boton) {
    return;
  }
  try {
    await patch(`/api/super/negocios/${boton.dataset.id}`, { activo: boton.dataset.activo === "true" });
    toast(boton.dataset.activo === "true" ? "Negocio activado." : "Negocio desactivado.");
    await cargar();
  } catch (problema) {
    toast(textoError(problema), true);
  }
});

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorForm.hidden = true;
  if (!form.reportValidity()) {
    return;
  }
  try {
    const creado = await post("/api/super/negocios", {
      nombre: form.nombre.value.trim(),
      slug: form.slug.value.trim(),
      descripcion: form.descripcion.value.trim(),
      adminNombre: form.adminNombre.value.trim(),
      adminEmail: form.adminEmail.value.trim(),
      adminPassword: form.adminPassword.value
    });
    // El alta devuelve la puerta de entrada del negocio recién creado: es lo
    // único que quien lo dio de alta no puede inventarse después.
    toast(creado.mensaje || "Negocio creado.");
    form.reset();
    await cargar();
  } catch (problema) {
    errorForm.textContent = textoError(problema);
    errorForm.hidden = false;
  }
});

// Datos del chip y validación de rol; si no es superadmin, redirige.
(async () => {
  const sesion = await exigirSesion("SUPERADMIN");
  if (!sesion) {
    return;
  }
  conectarSalir();
  await cargar();
})();
