/**
 * Cola de citas pendientes. Es la misma vista en el panel y en la página de
 * citas, así que vive aquí y las dos la pintan calling `cargarPendientes`.
 *
 * No lleva lógica de negocio: sólo pide la cola al servidor y la dibuja. Las
 * acciones (confirmar, rechazar…) están en cita-modal.js, que se abre al pulsar
 * una fila.
 */
import { ESTADOS_CITA, esc, fecha, get, insignia } from "../api.js";
import { vacio } from "../ui.js";
import { abrirCita } from "./cita-modal.js";

/**
 * @param {object} opciones
 * @param {string} opciones.contenedor  - selector del <div> donde se pinta.
 * @param {string} [opciones.contador]   - selector donde va el total.
 * @param {number} [opciones.limite]     - cuántas mostrar (por defecto 6).
 * @param {Function} [opciones.alCambiar] - callback a ejecutar tras resolver una.
 */
export async function cargarPendientes({
  contenedor,
  contador = null,
  limite = 6,
  alCambiar = null
} = {}) {
  const destino = typeof contenedor === "string" ? document.querySelector(contenedor) : contenedor;
  if (!destino) {
    return;
  }

  let pendientes;
  try {
    pendientes = await get(`/api/appointments?estado=PENDING&limit=${limite}`);
  } catch (error) {
    destino.innerHTML = "";
    destino.innerHTML = vacio("No se pudo cargar", "Inténtalo de nuevo en un momento.");
    return;
  }

  if (contador) {
    const destinoContador = document.querySelector(contador);
    if (destinoContador) {
      // El total sale de /resumen: aquí sólo llega la página pedida.
      const { resumen } = await get("/api/appointments/resumen");
      destinoContador.textContent = resumen.pendientes;
    }
  }

  destino.innerHTML =
    pendientes.items.length === 0
      ? vacio("Nada pendiente", "No hay citas esperando respuesta.")
      : pendientes.items.map(filaPendiente).join("");

  for (const fila of destino.querySelectorAll("[data-id]")) {
    fila.classList.add("appointment-row--clickable");
    fila.setAttribute("tabindex", "0");
    fila.setAttribute("role", "button");
    const abrir = () => void abrirCita(Number(fila.dataset.id), { alCambiar });
    fila.addEventListener("click", abrir);
    fila.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        abrir();
      }
    });
  }
}

/** Una cita pendiente. El cliente se muestra porque es quien hay que decidir. */
function filaPendiente(cita) {
  return `
    <article class="appointment-row" data-id="${cita.id}" style="--accent:var(--warning)">
      <div class="appointment-main">
        <span class="appointment-when">${esc(cita.task?.title || "Cita")}</span>
        <span class="appointment-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || "")}–${esc(cita.availability?.endTime || "")}
          · ${esc(cita.task?.category?.name || "Sin categoría")}
        </span>
        ${cita.note ? `<p class="appointment-note">${esc(cita.note)}</p>` : ""}
      </div>
      ${cita.client ? `<span class="chip">${esc(cita.client.nombre)}</span>` : ""}
      ${insignia(cita.status, ESTADOS_CITA)}
    </article>`;
}
