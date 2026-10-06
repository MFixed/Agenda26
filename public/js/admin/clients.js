/**
 * Panel de clientes: alta, edición, ficha y baja. El email y la contraseña se
 * gestionan desde la cuenta del usuario; aquí sólo se editan.
 */
import {
  conectarSalir,
  datosDe,
  del,
  esc,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  hoy,
  post,
  put,
  toast,
  textoError
} from "../api.js";
import { avatar, confirmar, dato, montarCabecera, vacio } from "../ui.js";

const sesion = await exigirSesion("ADMIN");
montarCabecera(sesion);
conectarSalir();

const lista = document.querySelector("#lista-clientes");
const mensajeLista = document.querySelector("#lista-message");
const dialogoCliente = document.querySelector("#cliente-dialog");
const formularioCliente = document.querySelector("#cliente-form");
const errorCliente = document.querySelector("#cliente-error");

let clientes = [];

/* ---------------- Listado ---------------- */

async function cargar() {
  const busqueda = document.querySelector("#buscar").value.trim();
  try {
    const datos = await get(`/api/clients?limit=200${busqueda ? `&q=${encodeURIComponent(busqueda)}` : ""}`);
    clientes = datos.items;

    lista.innerHTML = clientes.length === 0 ? vacio("Sin clientes", "Cambia la búsqueda o da de alta uno.") : clientes.map(filaCliente).join("");
    pintarResumen(datos.items);
    mensajeLista.textContent = "";

    for (const fila of lista.querySelectorAll("[data-id]")) {
      fila.addEventListener("click", (evento) => {
        if (evento.target.closest("button[data-accion]")) {
          return;
        }
        void abrirDetalle(Number(fila.dataset.id));
      });
    }
  } catch (error) {
    lista.innerHTML = "";
    mensajeLista.textContent = textoError(error);
    mensajeLista.classList.add("error");
  }
}

function filaCliente(cliente) {
  const meta = [cliente.email, cliente.documento && `Doc. ${cliente.documento}`]
    .filter(Boolean)
    .join(" · ");

  return `
    <article class="client-row${cliente.activo ? "" : " client-row--off"}" data-id="${cliente.id}" tabindex="0" role="button">
      ${avatar(cliente.nombre)}
      <div class="client-row-main">
        <span class="client-row-name">${esc(cliente.nombre)}</span>
        <span class="client-row-meta">${esc(meta)}</span>
      </div>
      <div class="client-row-actions">
        <span class="chip">${cliente.citas} cita${cliente.citas === 1 ? "" : "s"}</span>
        <span class="badge ${cliente.activo ? "badge-active" : "badge-inactive"}">${cliente.activo ? "activo" : "inactivo"}</span>
        <button class="icon-button" type="button" data-accion="editar" aria-label="Editar">✎</button>
        <button class="icon-button danger" type="button" data-accion="borrar" aria-label="Eliminar">×</button>
      </div>
    </article>`;
}

function pintarResumen(listaClientes) {
  const conCitas = listaClientes.filter((cliente) => cliente.citas > 0).length;
  const inactivos = listaClientes.filter((cliente) => !cliente.activo).length;
  const mes = hoy().slice(0, 7);
  const esteMes = listaClientes.filter((cliente) => (cliente.createdAt || "").slice(0, 7) === mes).length;

  document.querySelector("#stat-total").textContent = listaClientes.length;
  document.querySelector("#stat-con-citas").textContent = conCitas;
  document.querySelector("#stat-inactivos").textContent = inactivos;
  document.querySelector("#stat-mes").textContent = esteMes;
}

/* ---------------- Ficha ---------------- */

async function abrirDetalle(id) {
  const dialogo = document.querySelector("#detalle-dialog");
  let cliente;
  try {
    ({ cliente } = await get(`/api/clients/${id}`));
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  dialogo.innerHTML = `
    <div class="modal-body">
      <div class="panel-heading">
        <div class="client-row" style="border:0;padding:0;background:transparent">
          ${avatar(cliente.nombre, true)}
          <div class="client-row-main">
            <span class="client-row-name" style="font-size:1.1rem">${esc(cliente.nombre)}</span>
            <span class="client-row-meta">${esc(cliente.email)}</span>
          </div>
        </div>
        <button class="icon-button" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="detail-grid">
        ${dato("Documento", cliente.documento)}
        ${dato("Nacimiento", cliente.fechaNacimiento ? `${fecha(cliente.fechaNacimiento)} · ${cliente.edad} años` : "")}
        ${dato("Teléfono", cliente.telefono)}
        ${dato("Cuenta", cliente.activo ? "Activa" : "Inactiva")}
        ${dato("Citas", String(cliente.citas))}
        ${dato("Tareas", String(cliente.tareas))}
        ${dato("Último acceso", fechaHora(cliente.ultimoAcceso))}
        ${dato("Alta", fechaHora(cliente.createdAt))}
        ${dato("Dirección", cliente.direccion, true)}
      </div>

      <div class="modal-foot">
        <a class="button button-quiet button-sm" href="/admin/citas?nueva=1">Registrar cita</a>
        <button class="button button-primary button-sm" data-editar type="button">Editar</button>
        <button class="button button-danger button-sm" data-borrar type="button">Eliminar</button>
      </div>
    </div>`;

  dialogo.querySelector("[data-cerrar]").addEventListener("click", () => dialogo.close());
  dialogo.querySelector("[data-editar]").addEventListener("click", () => {
    dialogo.close();
    abrirEditor(cliente);
  });
  dialogo.querySelector("[data-borrar]").addEventListener("click", async () => {
    dialogo.close();
    await borrar(cliente);
  });

  dialogo.showModal();
}

/* ---------------- Alta y edición ---------------- */

function abrirEditor(cliente) {
  formularioCliente.reset();
  errorCliente.hidden = true;

  const id = cliente ? cliente.id : "";
  document.querySelector("#cliente-id").value = id;
  document.querySelector("#cliente-dialog-title").textContent = cliente ? "Editar cliente" : "Nuevo cliente";
  document.querySelector("#cliente-nombre").value = cliente?.nombre || "";
  document.querySelector("#cliente-documento").value = cliente?.documento || "";
  document.querySelector("#cliente-nacimiento").value = cliente?.fechaNacimiento || "";
  document.querySelector("#cliente-email").value = cliente?.email || "";
  document.querySelector("#cliente-telefono").value = cliente?.telefono || "";
  document.querySelector("#cliente-direccion").value = cliente?.direccion || "";
  document.querySelector("#cliente-password").value = "";
  document.querySelector("#cliente-activo").checked = cliente ? cliente.activo : true;

  document.querySelector("#cliente-password-label").textContent = cliente ? "Contraseña nueva" : "Contraseña";
  document.querySelector("#cliente-password-ayuda").textContent = cliente
    ? "Déjala vacía para no cambiarla."
    : "Si la dejas vacía se genera una temporal.";

  dialogoCliente.showModal();
  document.querySelector("#cliente-nombre").focus();
}

formularioCliente.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorCliente.hidden = true;
  if (!formularioCliente.reportValidity()) {
    return;
  }

  const id = document.querySelector("#cliente-id").value;
  const datos = datosDe(formularioCliente);
  const cuerpo = {
    nombre: datos.nombre,
    documento: datos.documento,
    fechaNacimiento: datos.fechaNacimiento,
    email: datos.email,
    telefono: datos.telefono || null,
    direccion: datos.direccion || null,
    activo: datos.activo
  };
  if (datos.password) {
    cuerpo.password = datos.password;
  }

  try {
    if (id) {
      await put(`/api/clients/${id}`, cuerpo);
      toast("Cliente actualizado.");
    } else {
      const respuesta = await post("/api/clients", cuerpo);
      dialogoCliente.close();
      toast(
        respuesta.passwordTemporal
          ? `Cliente creado. Contraseña temporal: ${respuesta.passwordTemporal}`
          : "Cliente creado."
      );
      await cargar();
      return;
    }
    dialogoCliente.close();
    await cargar();
  } catch (error) {
    errorCliente.textContent = textoError(error);
    errorCliente.hidden = false;
  }
});

document.querySelector("#nuevo-cliente").addEventListener("click", () => abrirEditor(null));
document.querySelector("#close-cliente-dialog").addEventListener("click", () => dialogoCliente.close());
document.querySelector("#cancel-cliente-dialog").addEventListener("click", () => dialogoCliente.close());

/* ---------------- Borrar ---------------- */

async function borrar(cliente) {
  const ok = await confirmar({
    titulo: "Eliminar cliente",
    texto: `Se eliminará la cuenta de ${cliente.nombre} (${cliente.email}).`,
    aviso: "También desaparecen sus citas, tareas y notificaciones. No se puede deshacer.",
    textoBoton: "Eliminar"
  });
  if (!ok) {
    return;
  }
  try {
    await del(`/api/clients/${cliente.id}`);
    toast("Cliente eliminado.");
    await cargar();
  } catch (error) {
    toast(textoError(error), true);
  }
}

lista.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("button[data-accion]");
  if (!boton) {
    return;
  }
  const id = Number(boton.closest("[data-id]").dataset.id);
  const cliente = clientes.find((item) => item.id === id);

  if (boton.dataset.accion === "editar") {
    const detalle = await get(`/api/clients/${id}`);
    abrirEditor(detalle.cliente);
  } else if (cliente) {
    await borrar(cliente);
  }
});

/* ---------------- Filtros ---------------- */

let temporizador = null;
document.querySelector("#buscar").addEventListener("input", () => {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => void cargar(), 250);
});
document.querySelector("#recargar").addEventListener("click", () => void cargar());

await cargar();
