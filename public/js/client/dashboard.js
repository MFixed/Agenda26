/**
 * Panel del cliente: sus citas, los horarios libres y la reserva de cita.
 * La hora se elige tocando un horario de la lista; el resto lo pone la
 * administración.
 */
import {
  ESTADOS_CITA,
  conectarSalir,
  datosDe,
  esc,
  exigirSesion,
  fecha,
  get,
  insignia,
  post,
  toast,
  textoError
} from "../api.js";
import { confirmar, dato, filaCita, montarCabecera, vacio } from "../ui.js";

const sesion = await exigirSesion("CLIENT");
montarCabecera(sesion);
conectarSalir();

const listaCitas = document.querySelector("#lista-citas");
const listaHuecos = document.querySelector("#lista-huecos");
const dialogoPedir = document.querySelector("#pedir-dialog");
const formularioPedir = document.querySelector("#pedir-form");
const errorPedir = document.querySelector("#pedir-error");

let huecos = [];
let categorias = [];
let citas = [];

/* ---------------- Carga ---------------- */

async function cargar() {
  await Promise.all([cargarCitas(), cargarHuecos(), cargarCategorias()]);
}

async function cargarCitas() {
  const { items } = await get("/api/appointments?limit=100");
  citas = items;

  const pendientes = citas.filter((cita) => cita.status === "PENDING").length;
  const coordinadas = citas.filter((cita) => cita.status === "COORDINATED").length;
  const futuras = citas
    .filter((cita) => ["PENDING", "COORDINATED"].includes(cita.status))
    .sort((a, b) => (a.availability?.date || "").localeCompare(b.availability?.date || ""));

  document.querySelector("#stat-total").textContent = citas.length;
  document.querySelector("#stat-pendientes").textContent = pendientes;
  document.querySelector("#stat-coordinadas").textContent = coordinadas;
  document.querySelector("#stat-proxima").textContent = futuras[0] ? fecha(futuras[0].availability?.date) : "—";

  listaCitas.innerHTML =
    citas.length === 0
      ? vacio("Todavía no tienes citas", "Reserva un horario libre en el panel de la derecha.")
      : citas.slice(0, 6).map((cita) => filaCita(cita)).join("");

  for (const fila of listaCitas.querySelectorAll("[data-id]")) {
    fila.classList.add("appointment-row--clickable");
    fila.setAttribute("tabindex", "0");
    fila.setAttribute("role", "button");
    fila.addEventListener("click", () => void abrirCita(Number(fila.dataset.id)));
    fila.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        void abrirCita(Number(fila.dataset.id));
      }
    });
  }
}

async function cargarHuecos() {
  try {
    const { items } = await get("/api/availability");
    huecos = items;

    document.querySelector("#huecos-total").textContent =
      huecos.length === 0 ? "sin huecos" : `${huecos.length} hueco${huecos.length === 1 ? "" : "s"}`;

    listaHuecos.innerHTML =
      huecos.length === 0
        ? '<p class="muted">Ahora mismo no hay horarios publicados. Vuelve más adelante.</p>'
        : huecos.slice(0, 12).map(botonHueco).join("");
  } catch (error) {
    listaHuecos.innerHTML = "";
    document.querySelector("#huecos-total").textContent = "";
    toast(textoError(error), true);
  }
}

async function cargarCategorias() {
  try {
    ({ items: categorias } = await get("/api/categories"));
  } catch {
    categorias = [];
  }

  const selector = document.querySelector("#pedir-categoria");
  selector.innerHTML =
    '<option value="">SERVICIOS (por defecto)</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join("");
}

function botonHueco(hueco) {
  return `
    <button class="slot-button" type="button" data-hueco="${hueco.id}">
      <strong>${esc(hueco.startTime)}–${esc(hueco.endTime)}</strong>
      <small>${esc(fecha(hueco.date))}${hueco.note ? ` · ${esc(hueco.note)}` : ""}</small>
    </button>`;
}

/* ---------------- Reservar horario ---------------- */

function abrirPedir(hueco) {
  formularioPedir.reset();
  errorPedir.hidden = true;

  document.querySelector("#pedir-availability").value = hueco.id;
  document.querySelector("#pedir-fecha").value = `${fecha(hueco.date)} · ${hueco.startTime}–${hueco.endTime}`;
  document.querySelector("#pedir-resumen").textContent =
    "Al enviar la solicitud el horario queda en espera hasta que la administración la confirme. Si la rechazan, se libera.";

  dialogoPedir.showModal();
  document.querySelector("#pedir-nota").focus();
}

listaHuecos.addEventListener("click", (evento) => {
  const boton = evento.target.closest("[data-hueco]");
  if (!boton) {
    return;
  }
  const hueco = huecos.find((item) => item.id === Number(boton.dataset.hueco));
  if (hueco) {
    abrirPedir(hueco);
  }
});

document.querySelector("#close-pedir").addEventListener("click", () => dialogoPedir.close());
document.querySelector("#cancel-pedir").addEventListener("click", () => dialogoPedir.close());

formularioPedir.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorPedir.hidden = true;

  const datos = datosDe(formularioPedir);
  try {
    await post("/api/appointments", {
      availabilityId: Number(datos.availabilityId),
      categoryId: datos.categoria ? Number(datos.categoria) : null,
      title: datos.servicio || null,
      note: datos.note || null
    });
    dialogoPedir.close();
    toast("Solicitud enviada. Te avisaremos cuando la confirmen.");
    await cargar();
  } catch (error) {
    errorPedir.textContent = textoError(error);
    errorPedir.hidden = false;
  }
});

/* ---------------- Detalle de cita ---------------- */

async function abrirCita(id) {
  const dialogo = document.querySelector("#detalle-dialog");
  let cita;
  try {
    ({ cita } = await get(`/api/appointments/${id}`));
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  const historial = (cita.historial || [])
    .map(
      (evento) => `
      <li>
        <strong>${esc(evento.toStatus)}</strong>
        <time class="muted">${esc(fecha(evento.createdAt))}</time>
        ${evento.note ? `<p class="muted">${esc(evento.note)}</p>` : ""}
      </li>`
    )
    .join("");

  dialogo.innerHTML = `
    <div class="modal-body">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Cita #${cita.id}</p>
          <h2 id="detalle-title">${esc(cita.task?.title || "Cita")}</h2>
        </div>
        <button class="icon-button" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="detail-grid">
        ${dato("Estado", "")}
        ${dato("Categoría", cita.task?.category?.name)}
        ${dato("Fecha", fecha(cita.availability?.date))}
        ${dato("Horario", `${cita.availability?.startTime || ""} – ${cita.availability?.endTime || ""}`)}
        ${dato("Solicitada", fecha(cita.createdAt))}
        ${dato("Anotación", cita.note, true)}
      </div>

      ${
        cita.status === "PENDING"
          ? '<p class="flow-note">La administración todavía no ha confirmado tu cita. Puedes cancelarla si ya no la necesitas.</p>'
          : ""
      }
      ${
        cita.status === "COORDINATED"
          ? '<p class="flow-note">Tu cita está confirmada. Acude el día y a la hora indicados.</p>'
          : ""
      }
      ${historial ? `<section><h3>Historial</h3><ul class="stack-list">${historial}</ul></section>` : ""}

      <div class="modal-foot">
        ${
          cita.status === "PENDING"
            ? '<button class="button button-danger button-sm" data-cancelar type="button">Cancelar mi cita</button>'
            : ""
        }
      </div>
    </div>`;

  // El estado se pinta con la insignia oficial en lugar de texto plano.
  const celdaEstado = dialogo.querySelector("#detalle-dialog .detail-item:first-child strong");
  if (celdaEstado) {
    celdaEstado.innerHTML = insignia(cita.status, ESTADOS_CITA);
  }

  dialogo.querySelector("[data-cerrar]").addEventListener("click", () => dialogo.close());
  dialogo.querySelector("[data-cancelar]")?.addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "Cancelar la cita",
      texto: `Vas a cancelar "${cita.task?.title || "tu cita"}" del ${fecha(cita.availability?.date)}.`,
      aviso: "El horario vuelve a quedar libre para otras personas.",
      textoBoton: "Cancelar cita"
    });
    if (!ok) {
      return;
    }
    try {
      await post(`/api/appointments/${cita.id}/cancelar`, {});
      dialogo.close();
      toast("Cita cancelada.");
      await cargar();
    } catch (error) {
      toast(textoError(error), true);
    }
  });

  dialogo.showModal();
}

await cargar();
