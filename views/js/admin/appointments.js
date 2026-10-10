/**
 * Listado de citas del administrador: filtros por estado y cliente, búsqueda por
 * texto, paginación y resolución de cada cita.
 *
 * El alta de citas no está aquí: vive en el panel principal, que es el único
 * sitio desde el que se crean.
 */
import {
  ESTADOS_CITA,
  conectarSalir,
  esc,
  exigirSesion,
  fecha,
  get,
  insignia,
  textoError
} from "../api.js";
import { montarCabecera, vacio } from "../ui.js";
import { abrirCita } from "./cita-modal.js";
import { cargarPendientes } from "./pendientes.js";

const sesion = await exigirSesion("ADMIN");
montarCabecera(sesion);
conectarSalir();

const LIMIT = 20;
const filtros = { estado: "", cliente: "", q: "", pagina: 1 };
let totalPaginas = 1;

const lista = document.querySelector("#lista-citas");
const mensajeLista = document.querySelector("#lista-message");

/* ---------------- Carga ---------------- */

async function cargar() {
  const parametros = new URLSearchParams({
    estado: filtros.estado,
    q: filtros.q,
    limit: String(LIMIT),
    offset: String((filtros.pagina - 1) * LIMIT)
  });
  if (filtros.cliente) {
    parametros.set("clientId", filtros.cliente);
  }

  try {
    const [citas, resumen] = await Promise.all([
      get(`/api/appointments?${parametros}`),
      get("/api/appointments/resumen")
    ]);

    totalPaginas = Math.max(1, Math.ceil(citas.total / LIMIT));
    pintar(citas.items);
    pintarPaginacion(citas.total);
    pintarResumen(resumen.resumen);
  } catch (error) {
    lista.innerHTML = "";
    mensajeLista.textContent = textoError(error);
    mensajeLista.classList.add("error");
  }

  // La cola de pendientes es la misma vista del panel principal, sólo que aquí
  // no se limita a 6: se ven todas las que esperan respuesta.
  await cargarPendientes({
    contenedor: "#lista-pendientes",
    contador: "#pendientes-total",
    limite: 50,
    alCambiar: cargar
  });
}

function pintar(citas) {
  lista.innerHTML =
    citas.length === 0
      ? vacio("Sin citas", 'Prueba con otro filtro, o crea una nueva desde el panel principal.')
      : citas
          .map((cita) => {
            const conCliente = `<span class="chip">${esc(cita.client?.nombre || "Sin cliente")}</span>`;
            return filaConCliente(cita, conCliente);
          })
          .join("");

  for (const fila of lista.querySelectorAll("[data-id]")) {
    fila.addEventListener("click", (evento) => {
      // El enlace de WhatsApp no debe abrir el detalle cuando lo pulsas.
      if (evento.target.closest("[data-wpp]")) {
        return;
      }
      void abrirCita(Number(fila.dataset.id), { alCambiar: cargar });
    });
    fila.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        void abrirCita(Number(fila.dataset.id), { alCambiar: cargar });
      }
    });
  }
}

function filaConCliente(cita, conCliente) {
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
      ${conCliente}
      ${botonRecordatorio(cita)}
      ${insignia(cita.status, ESTADOS_CITA)}
    </article>`;
}

/**
 * Botón de recordatorio por WhatsApp: sólo tiene sentido en citas ya
 * confirmadas y si el cliente tiene teléfono en su ficha.
 */
function botonRecordatorio(cita) {
  if (cita.status !== "COORDINATED" || !cita.client?.telefono) {
    return "";
  }
  // Uruguay: prefijo 598. Los móviles locales empiezan con 09, pero al
  // escribirlos en formato internacional se les quita ese 0 inicial.
  let numero = cita.client.telefono.replace(/\D/g, "");
  if (!numero) {
    return "";
  }
  if (!numero.startsWith("598")) {
    numero = numero.replace(/^0+/, "");
    numero = `598${numero}`;
  }
  const texto =
    `¡Hola ${cita.client.nombre}! 👋 Te recordamos tu cita de "${cita.task?.title || "Cita"}" ` +
    `el ${fecha(cita.availability?.date)} · ${cita.availability?.startTime || ""}–${cita.availability?.endTime || ""}. ` +
    `¡Te esperamos!`;
  return `<a class="button button-quiet button-sm" data-wpp href="https://wa.me/${numero}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">📣 Recordatorio</a>`;
}

function pintarResumen(resumen) {
  document.querySelector("#stat-pendientes").textContent = resumen.pendientes;
  document.querySelector("#stat-coordinadas").textContent = resumen.coordinadas;
  document.querySelector("#stat-completadas").textContent = resumen.completadas;
  document.querySelector("#stat-cerradas").textContent = resumen.canceladas + resumen.rechazadas;
}

function pintarPaginacion(total) {
  const paginador = document.querySelector("#pager");
  paginador.hidden = total <= LIMIT;
  document.querySelector("#pager-info").textContent =
    `Página ${filtros.pagina} de ${totalPaginas} · ${total} cita${total === 1 ? "" : "s"}`;
  document.querySelector("#pager-anterior").disabled = filtros.pagina <= 1;
  document.querySelector("#pager-siguiente").disabled = filtros.pagina >= totalPaginas;
}

/* ---------------- Filtros ---------------- */

let temporizador = null;
document.querySelector("#buscar").addEventListener("input", (evento) => {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    filtros.q = evento.target.value.trim();
    filtros.pagina = 1;
    void cargar();
  }, 250);
});

document.querySelector("#filtro-estado").addEventListener("change", (evento) => {
  filtros.estado = evento.target.value;
  filtros.pagina = 1;
  void cargar();
});

document.querySelector("#filtro-cliente").addEventListener("change", (evento) => {
  filtros.cliente = evento.target.value;
  filtros.pagina = 1;
  void cargar();
});

document.querySelector("#recargar").addEventListener("click", () => void cargar());
document.querySelector("#pager-anterior").addEventListener("click", () => {
  filtros.pagina = Math.max(1, filtros.pagina - 1);
  void cargar();
});
document.querySelector("#pager-siguiente").addEventListener("click", () => {
  filtros.pagina = Math.min(totalPaginas, filtros.pagina + 1);
  void cargar();
});

/* ---------------- Filtro por cliente ---------------- */

/* El alta de citas vive en el panel principal: allí también se puede
   habilitar el horario, que es lo que hace falta al registrar a alguien que
   aún no tiene hueco. Aquí sólo se consulta y se resuelve. */

async function cargarFiltroClientes() {
  try {
    const { items } = await get("/api/clients?limit=200");
    document.querySelector("#filtro-cliente").innerHTML =
      '<option value="">Todos los clientes</option>' +
      items.map((cliente) => `<option value="${cliente.id}">${esc(cliente.nombre)}</option>`).join("");
  } catch {
    // El filtro es una comodidad: si falla, el listado sigue funcionando.
  }
}

/* ---------------- Arranque ---------------- */

await Promise.all([cargar(), cargarFiltroClientes()]);
