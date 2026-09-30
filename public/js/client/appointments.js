/**
 * Historial de citas del cliente: filtro por estado, detalle con el historial de
 * cambios y cancelación mientras siga pendiente.
 */
import {
  ESTADOS_CITA,
  conectarSalir,
  datosDe,
  esc,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  insignia,
  post,
  toast,
  textoError
} from "../api.js";
import { confirmar, dato, montarCabecera, vacio } from "../ui.js";

const sesion = await exigirSesion("CLIENT");
montarCabecera(sesion);
conectarSalir();

const lista = document.querySelector("#lista-citas");
const mensajeLista = document.querySelector("#lista-message");
const dialogoPedir = document.querySelector("#pedir-dialog");
const formularioPedir = document.querySelector("#pedir-form");
const errorPedir = document.querySelector("#pedir-error");

let citas = [];

/* ---------------- Listado ---------------- */

async function cargar() {
  const estado = document.querySelector("#filtro-estado").value;
  try {
    const respuesta = await get(`/api/appointments?limit=200${estado ? `&estado=${estado}` : ""}`);
    citas = respuesta.items;

    lista.innerHTML =
      citas.length === 0
        ? vacio("Sin citas", "Cuando pidas una cita aparecerá aquí con su estado.")
        : citas.map(filaCita).join("");
    mensajeLista.textContent = "";

    for (const fila of lista.querySelectorAll("[data-id]")) {
      fila.addEventListener("click", () => void abrirDetalle(Number(fila.dataset.id)));
      fila.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.preventDefault();
          void abrirDetalle(Number(fila.dataset.id));
        }
      });
    }
  } catch (error) {
    lista.innerHTML = "";
    mensajeLista.textContent = textoError(error);
    mensajeLista.classList.add("error");
  }
}

function filaCita(cita) {
  const acento = { PENDING: "var(--warning)", COORDINATED: "var(--success)" }[cita.status] || "var(--muted)";
  return `
    <article class="appointment-row appointment-row--clickable" data-id="${cita.id}"
             style="--accent:${acento}" tabindex="0" role="button">
      <div class="appointment-main">
        <span class="appointment-when">${esc(cita.task?.title || "Cita")}</span>
        <span class="appointment-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || "")}–${esc(cita.availability?.endTime || "")}
          · ${esc(cita.task?.category?.name || "Sin categoría")}
        </span>
        ${cita.note ? `<p class="appointment-note">${esc(cita.note)}</p>` : ""}
      </div>
      ${insignia(cita.status, ESTADOS_CITA)}
    </article>`;
}

/* ---------------- Detalle ---------------- */

async function abrirDetalle(id) {
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
        ${evento.fromStatus ? `<span class="muted"> desde ${esc(evento.fromStatus)}</span>` : ""}
        <time class="muted">${esc(fechaHora(evento.createdAt))}</time>
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
        ${dato("Solicitada", fechaHora(cita.createdAt))}
        ${dato("Última actualización", fechaHora(cita.updatedAt))}
        ${dato("Tu anotación", cita.note, true)}
      </div>

      ${
        historial
          ? `<section><h3>Historial</h3><ul class="stack-list">${historial}</ul></section>`
          : ""
      }

      <div class="modal-foot">
        ${
          cita.status === "PENDING"
            ? '<button class="button button-danger button-sm" data-cancelar type="button">Cancelar mi cita</button>'
            : ""
        }
      </div>
    </div>`;

  const celdaEstado = dialogo.querySelector(".detail-item:first-child strong");
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

/* ---------------- Pedir cita ---------------- */

async function abrirPedir() {
  formularioPedir.reset();
  errorPedir.hidden = true;

  try {
    const [{ items: huecos }, { items: categorias }] = await Promise.all([
      get("/api/availability"),
      get("/api/categories")
    ]);

    if (huecos.length === 0) {
      toast("No hay horarios disponibles ahora mismo.", true);
      return;
    }

    document.querySelector("#pedir-hueco").innerHTML = huecos
      .map(
        (hueco) =>
          `<option value="${hueco.id}">${esc(fecha(hueco.date))} · ${esc(hueco.startTime)}–${esc(hueco.endTime)}</option>`
      )
      .join("");

    document.querySelector("#pedir-categoria").innerHTML =
      '<option value="">SERVICIOS (por defecto)</option>' +
      categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join("");
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  dialogoPedir.showModal();
}

document.querySelector("#pedir-cita").addEventListener("click", () => void abrirPedir());
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

document.querySelector("#filtro-estado").addEventListener("change", () => void cargar());

await cargar();
