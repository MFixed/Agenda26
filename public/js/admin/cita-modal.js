/**
 * Modal de detalle de una cita, compartido por el panel, el listado y el
 * calendario. Muestra la ficha completa y ofrece las acciones que el estado
 * permite; si el servidor rechaza una acción, se muestra su mensaje.
 */
import {
  ESTADOS_CITA,
  esc,
  fecha,
  fechaHora,
  get,
  insignia,
  post,
  put,
  toast,
  textoError
} from "../api.js";
import { dato, confirmar, errorEnConfirmacion } from "../ui.js";

const ACCIONES = {
  PENDING: [
    { accion: "coordinar", texto: "Confirmar cita", clase: "button-primary" },
    { accion: "rechazar", texto: "Rechazar", clase: "button-quiet" },
    { accion: "cancelar-admin", texto: "Cancelar", clase: "button-quiet" }
  ],
  COORDINATED: [
    { accion: "completar", texto: "Marcar completada", clase: "button-primary" },
    { accion: "cancelar-admin", texto: "Cancelar", clase: "button-quiet" }
  ],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: []
};

let huecoLibreElegido = null;

/**
 * Abre el detalle de una cita.
 * @param {number} id
 * @param {object} opciones - { alCambiar: callback } para refrescar la página.
 */
export async function abrirCita(id, { alCambiar } = {}) {
  const dialogo = document.querySelector("#detalle-dialog");
  if (!dialogo) {
    return;
  }

  let cita;
  try {
    ({ cita } = await get(`/api/appointments/${id}`));
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  dialogo.innerHTML = plantilla(cita);
  dialogo.showModal();

  dialogo.querySelector("[data-cerrar]")?.addEventListener("click", () => dialogo.close());

  dialogo.querySelector("[data-reprogramar]")?.addEventListener("click", async () => {
    await reprogramar(cita);
    await abrirCita(cita.id, { alCambiar });
    alCambiar?.();
  });

  for (const boton of dialogo.querySelectorAll("[data-accion]")) {
    boton.addEventListener("click", async () => {
      const hecha = await ejecutarAccion(cita, boton.dataset.accion);
      if (hecha) {
        await abrirCita(cita.id, { alCambiar });
        alCambiar?.();
      }
    });
  }

  dialogo.querySelector("[data-borrar]")?.addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "Eliminar cita",
      texto: `Se eliminará la cita de "${cita.task?.title || "sin título"}". El horario queda libre.`,
      aviso: "También se borra su historial. Esta acción no se puede deshacer.",
      textoBoton: "Eliminar"
    });
    if (!ok) {
      return;
    }
    try {
      const respuesta = await fetch(`/api/appointments/${cita.id}`, { method: "DELETE" });
      if (!respuesta.ok) {
        throw new Error("No se pudo eliminar.");
      }
      dialogo.close();
      toast("Cita eliminada.");
      alCambiar?.();
    } catch (error) {
      errorEnConfirmacion(textoError(error));
    }
  });

  dialogo.querySelector("[data-nota]")?.addEventListener("click", async () => {
    const campo = dialogo.querySelector("#cita-nota");
    try {
      await put(`/api/appointments/${cita.id}`, { note: campo.value.trim() });
      toast("Anotación guardada.");
      await abrirCita(cita.id, { alCambiar });
      alCambiar?.();
    } catch (error) {
      toast(textoError(error), true);
    }
  });
}

function plantilla(cita) {
  const acciones = ACCIONES[cita.status] || [];
  const historial = (cita.historial || [])
    .map(
      (evento) => `
      <li>
        <strong>${esc(evento.toStatus)}</strong>
        ${evento.fromStatus ? `<span class="muted"> desde ${esc(evento.fromStatus)}</span>` : ""}
        <time class="muted">${esc(fechaHora(evento.createdAt))}</time>
        ${evento.actor ? `<span class="chip">${esc(evento.actor.nombre)}</span>` : ""}
        ${evento.note ? `<p class="muted">${esc(evento.note)}</p>` : ""}
      </li>`
    )
    .join("");

  return `
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
        ${dato("Cliente", cita.client?.nombre)}
        ${dato("Correo", cita.client?.email)}
        ${dato("Teléfono", cita.client?.telefono)}
        ${dato("Categoría", cita.task?.category?.name)}
        ${dato("Fecha", fecha(cita.availability?.date))}
        ${dato("Horario", `${cita.availability?.startTime || ""} – ${cita.availability?.endTime || ""}`)}
        ${dato("Estado del hueco", cita.availability?.status)}
        ${dato("Creada", fechaHora(cita.createdAt))}
        ${dato("Última modificación", fechaHora(cita.updatedAt))}
      </div>

      <label class="field">
        <span>Anotación del cliente</span>
        <textarea id="cita-nota" rows="3" maxlength="1000" placeholder="Sin anotación">${esc(cita.note || "")}</textarea>
      </label>
      <div>
        <button class="button button-quiet button-sm" data-nota type="button">Guardar anotación</button>
      </div>

      ${
        historial
          ? `<section><h3>Historial</h3><ul class="stack-list">${historial}</ul></section>`
          : ""
      }

      <div class="modal-foot">
        ${acciones
          .map(
            (accion) =>
              `<button class="button ${accion.clase} button-sm" data-accion="${accion.accion}" type="button">${esc(accion.texto)}</button>`
          )
          .join("")}
        ${
          ["PENDING", "COORDINATED"].includes(cita.status)
            ? '<button class="button button-quiet button-sm" data-reprogramar type="button">Cambiar horario</button>'
            : ""
        }
        <button class="button button-danger button-sm" data-borrar type="button">Eliminar</button>
      </div>
    </div>`;
}

/** Ejecuta una transición de estado, con confirmación si es destructiva. */
async function ejecutarAccion(cita, accion) {
  const destructivas = ["rechazar", "cancelar-admin", "completar"];
  if (destructivas.includes(accion)) {
    const textos = {
      rechazar: ["Rechazar la cita", "El cliente será avisado de que no se le puede coordinar.", "Rechazar"],
      "cancelar-admin": ["Cancelar la cita", "El horario vuelve a quedar libre y el cliente será avisado.", "Cancelar"],
      completar: ["Completar la cita", "La cita y su tarea quedarán como completadas.", "Completar"]
    };
    const [titulo, aviso, textoBoton] = textos[accion];
    const ok = await confirmar({
      titulo,
      texto: `Cita de "${cita.task?.title || "sin título"}" (${fecha(cita.availability?.date)}).`,
      aviso,
      textoBoton
    });
    if (!ok) {
      return false;
    }
  }

  try {
    await post(`/api/appointments/${cita.id}/${accion}`, {});
    toast("Cita actualizada.");
    return true;
  } catch (error) {
    toast(textoError(error), true);
    return false;
  }
}

/** El admin mueve la cita a otro hueco libre. */
async function reprogramar(cita) {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
    .toISOString()
    .slice(0, 10);

  let huecos;
  try {
    ({ items: huecos } = await get(`/api/availability?estado=AVAILABLE&desde=${desde}`));
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  const libres = huecos.filter((hueco) => hueco.id !== cita.availabilityId);
  if (libres.length === 0) {
    toast("No hay horarios libres a partir de hoy.", true);
    return;
  }

  const elegido = window.prompt(
    `Elige el nuevo horario (1-${libres.length}):\n` +
      libres
        .slice(0, 20)
        .map(
          (hueco, indice) =>
            `${indice + 1}) ${fecha(hueco.date)} ${hueco.startTime}-${hueco.endTime}`
        )
        .join("\n"),
    "1"
  );
  if (!elegido) {
    return;
  }

  const destino = libres[Number.parseInt(elegido, 10) - 1];
  if (!destino) {
    toast("Opción no válida.", true);
    return;
  }

  try {
    await put(`/api/appointments/${cita.id}`, {
      availabilityId: destino.id,
      note: cita.note || ""
    });
    huecoLibreElegido = destino;
    toast("Cita reprogramada.");
  } catch (error) {
    toast(textoError(error), true);
  }
}

void insignia;
void ESTADOS_CITA;
