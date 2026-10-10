/**
 * Panel de administración (§16): cifras, citas por confirmar, próximas citas y
 * disponibilidad de hoy. Sólo pinta; las acciones están en cita-modal.js.
 *
 * Aquí vive también "Crear nueva cita", que además permite habilitar un horario
 * nuevo en el mismo paso: publicar disponibilidad y reservar la cita era una
 * molestia de dos viajes al calendario y ahora es un solo formulario.
 */
import {
  ESTADOS_HUECO,
  conectarSalir,
  datosDe,
  esc,
  exigirSesion,
  fecha,
  get,
  hoy,
  post,
  sumarDias,
  toast
} from "../api.js";
import { filaCita, montarCabecera, vacio } from "../ui.js";
import { abrirCita } from "./cita-modal.js";
import { cargarPendientes } from "./pendientes.js";

const sesion = await exigirSesion("ADMIN");
montarCabecera(sesion);
conectarSalir();

async function cargar() {
  await Promise.all([cargarCitas(), cargarTareas(), cargarDisponibilidad()]);
}

/* ---------------- Citas ---------------- */

async function cargarCitas() {
  const [resumen, coordinadas] = await Promise.all([
    get("/api/appointments/resumen"),
    get("/api/appointments?estado=COORDINATED&limit=10")
  ]);

  document.querySelector("#stat-pendientes").textContent = resumen.resumen.pendientes;
  document.querySelector("#stat-coordinadas").textContent = resumen.resumen.coordinadas;
  document.querySelector("#hoy-resumen").textContent = resumen.resumen.hoy
    ? `${resumen.resumen.hoy} cita${resumen.resumen.hoy === 1 ? "" : "s"} hoy`
    : "Sin citas hoy";

  // La cola la pinta el módulo compartido con la página de citas: es la misma.
  await cargarPendientes({ contenedor: "#lista-pendientes", limite: 6, alCambiar: cargar });

  // Las próximas son las coordinadas que aún no han pasado. Las PENDING ya
  // están en la cola de arriba, así que no se repiten aquí.
  const hoyISO = hoy();
  const futuras = coordinadas.items
    .filter((cita) => (cita.availability?.date || "9999") >= hoyISO)
    .slice(0, 5);

  const listaProximas = document.querySelector("#lista-proximas");
  listaProximas.innerHTML =
    futuras.length === 0
      ? vacio("Sin citas a la vista", "Publica disponibilidad para abrir huecos.")
      : futuras.map((cita) => filaCita(cita)).join("");

  for (const fila of listaProximas.querySelectorAll(".appointment-row[data-id]")) {
    fila.classList.add("appointment-row--clickable");
    fila.setAttribute("tabindex", "0");
    fila.setAttribute("role", "button");
    fila.addEventListener("click", () => void abrirCita(Number(fila.dataset.id), { alCambiar: cargar }));
    fila.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        void abrirCita(Number(fila.dataset.id), { alCambiar: cargar });
      }
    });
  }
}

/* ---------------- Tareas ---------------- */

async function cargarTareas() {
  // Alcance "propias": las tarjetas cuentan el trabajo del administrador, sin
  // las tareas que nacen de cada cita, que ya se resumen en las de arriba.
  const [pendientes, sinFecha] = await Promise.all([
    get("/api/tasks?alcance=propias&filtro=pendientes&limit=1"),
    get("/api/tasks?alcance=propias&filtro=sin-fecha&limit=1")
  ]);
  document.querySelector("#stat-tareas").textContent = pendientes.total;
  document.querySelector("#stat-sin-fecha").textContent = sinFecha.total;
}

/* ---------------- Horarios disponibles ---------------- */

/**
 * Lista los horarios a partir de hoy, agrupados por día. Se ven los cuatro
 * estados (libre, en espera, reservado, bloqueado) porque desde aquí lo que
 * interesa es saber qué huecos quedan por abrir, no sólo los ya usados.
 */
async function cargarDisponibilidad() {
  const contenedor = document.querySelector("#lista-disponibilidad");
  const resumen = document.querySelector("#disponibilidad-resumen");
  const desde = hoy();
  const hasta = sumarDias(desde, 30);

  let items;
  try {
    ({ items } = await get(`/api/availability?desde=${desde}&hasta=${hasta}`));
  } catch {
    contenedor.innerHTML = '<p class="muted">No se pudo cargar la disponibilidad.</p>';
    return;
  }

  const conteo = { AVAILABLE: 0, HELD: 0, RESERVED: 0, BLOCKED: 0 };
  for (const hueco of items) {
    conteo[hueco.status] = (conteo[hueco.status] || 0) + 1;
  }

  // "1 bloqueado" y no "1 bloqueados": la concordancia también se cuida.
  const plural = (total, singular, plural) => `${total} ${total === 1 ? singular : plural}`;
  resumen.textContent =
    items.length === 0
      ? "Sin horarios publicados en los próximos 30 días."
      : [
          plural(conteo.AVAILABLE, "libre", "libres"),
          plural(conteo.HELD, "en espera", "en espera"),
          plural(conteo.RESERVED, "reservado", "reservados"),
          plural(conteo.BLOCKED, "bloqueado", "bloqueados")
        ].join(" · ");

  if (items.length === 0) {
    contenedor.innerHTML =
      '<p class="muted">Todavía no hay horarios. Publica uno para que los clientes puedan reservar.</p>';
    return;
  }

  // Agrupar por fecha para que se lea como un agenda y no como una lista plana.
  const porDia = new Map();
  for (const hueco of items) {
    if (!porDia.has(hueco.date)) {
      porDia.set(hueco.date, []);
    }
    porDia.get(hueco.date).push(hueco);
  }

  contenedor.innerHTML = [...porDia.entries()]
    .map(
      ([dia, huecos]) => `
      <div class="disponibilidad-dia">
        <div class="disponibilidad-dia-cabecera">
          <strong>${esc(fecha(dia))}</strong>
          <span class="muted">${huecos.length} horario${huecos.length === 1 ? "" : "s"}</span>
        </div>
        <div class="slot-grid">
          ${huecos.map((hueco) => botonHueco(hueco)).join("")}
        </div>
      </div>`
    )
    .join("");
}

/** Un hueco de la lista, con su estado. */
function botonHueco(hueco) {
  const clase = { AVAILABLE: "", HELD: "held", RESERVED: "reserved", BLOCKED: "off" }[hueco.status] || "";
  const etiqueta = ESTADOS_HUECO[hueco.status]?.texto || hueco.status;
  return `
    <button class="slot-button ${clase}" type="button" disabled>
      <strong>${esc(hueco.startTime)}</strong>
      <small>${esc(hueco.endTime)} · ${esc(etiqueta)}</small>
    </button>`;
}

/* ------------------------------------------------------------------ *
 * Publicar horario
 * ------------------------------------------------------------------ */

const dialogoHorario = document.querySelector("#horario-dialog");
const formularioHorario = document.querySelector("#horario-form");
const errorHorario = document.querySelector("#horario-error");

/**
 * Convierte "09:00, 10:30, 12:00" en una lista de horas válidas.
 * Descarta en silencio lo que no sea una hora, que el servidor volverá a
 * comprobar de todos modos.
 */
function leerHoras(texto) {
  return [...new Set(texto.split(/[,\s]+/).map((parte) => parte.trim()).filter(Boolean))].filter((hora) =>
    /^([01]?\d|2[0-3]):[0-5]\d$/.test(hora)
  );
}

function abrirDialogoHorario(fechaPropuesta) {
  formularioHorario.reset();
  errorHorario.hidden = true;
  // Por defecto mañana: casi siempre se publica para el día siguiente.
  document.querySelector("#horario-fecha").value = fechaPropuesta || sumarDias(hoy(), 1);
  document.querySelector("#horario-horas").value = "09:00, 10:30, 12:00";
  dialogoHorario.showModal();
  document.querySelector("#horario-fecha").focus();
}

document.querySelector("#publicar-horario").addEventListener("click", abrirDialogoHorario);
document.querySelector("#publicar-horario-panel").addEventListener("click", abrirDialogoHorario);
document.querySelector("#close-horario-dialog").addEventListener("click", () => dialogoHorario.close());
document.querySelector("#cancel-horario-dialog").addEventListener("click", () => dialogoHorario.close());

formularioHorario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorHorario.hidden = true;
  if (!formularioHorario.reportValidity()) {
    return;
  }

  const datos = datosDe(formularioHorario);
  const horas = leerHoras(datos.horas);
  if (horas.length === 0) {
    errorHorario.textContent = "Escribe al menos una hora válida (HH:mm).";
    errorHorario.hidden = false;
    return;
  }
  // Las horas se publican en orden: así el listado sale limpio.
  horas.sort();

  const boton = formularioHorario.querySelector('button[type="submit"]');
  boton.disabled = true;

  // Se publica de uno en uno y se va apuntando lo que falla, para no perder el
  // trabajo si el usuario repite una hora que ya existe.
  const publicadas = [];
  const rechazadas = [];

  for (const hora of horas) {
    const [h, m] = hora.split(":").map(Number);
    // Cada franja dura una hora. A las 23:00 acaba a las 23:59 porque 24:00 no
    // es una hora válida.
    const fin = h === 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    try {
      await post("/api/availability", {
        date: datos.date,
        startTime: hora,
        endTime: fin,
        status: datos.status || "AVAILABLE",
        note: datos.note || null
      });
      publicadas.push(hora);
    } catch {
      rechazadas.push(hora);
    }
  }

  boton.disabled = false;
  await cargar();

  if (rechazadas.length === 0) {
    dialogoHorario.close();
    toast(
      publicadas.length === 1
        ? `Horario de las ${publicadas[0]} publicado.`
        : `${publicadas.length} horarios publicados.`
    );
    return;
  }

  if (publicadas.length === 0) {
    errorHorario.textContent =
      "No se publicó ninguno. Quita las horas repetidas o ya ocupadas y vuelve a intentarlo.";
    errorHorario.hidden = false;
    return;
  }

  // Parcial: unas entraron y otras no. El trabajo útil está hecho, así que se
  // cierra el diálogo y se avisa de cuáles quedaron fuera.
  dialogoHorario.close();
  toast(`${publicadas.length} publicados. Se omitieron: ${rechazadas.join(", ")}.`);
});

/* ------------------------------------------------------------------ *
 * Crear nueva cita (con horario opcional)
 * ------------------------------------------------------------------ */

const dialogoCita = document.querySelector("#cita-dialog");
const formularioCita = document.querySelector("#cita-form");
const errorCita = document.querySelector("#cita-error");
const casillaNuevoHorario = document.querySelector("#cita-nuevo-horario");
const camposNuevoHorario = document.querySelector("#nuevo-horario-campos");
const mensajeNuevoHorario = document.querySelector("#nuevo-horario-mensaje");

/** Carga clientes, categorías y huecos libres para el formulario. */
async function cargarOpcionesCita() {
  const [{ items: clientes }, { items: categorias }, { items: huecos }] = await Promise.all([
    get("/api/clients?limit=200"),
    get("/api/categories"),
    get("/api/availability?estado=AVAILABLE&desde=" + hoy())
  ]);

  const selectorCliente = document.querySelector("#cita-cliente");
  selectorCliente.innerHTML = clientes.length
    ? '<option value="">Elige un cliente…</option>' +
      clientes
        .map((cliente) => `<option value="${cliente.id}">${esc(cliente.nombre)}</option>`)
        .join("")
    : '<option value="">No hay clientes dados de alta</option>';
  selectorCliente.disabled = clientes.length === 0;

  const selectorHorario = document.querySelector("#cita-horario");
  selectorHorario.innerHTML = huecos.length
    ? huecos
        .map(
          (hueco) =>
            `<option value="${hueco.id}">${esc(hueco.date)} · ${esc(hueco.startTime)}–${esc(hueco.endTime)}</option>`
        )
        .join("")
    : '<option value="">No hay horarios libres a partir de hoy</option>';

  document.querySelector("#cita-categoria").innerHTML =
    '<option value="">SERVICIOS (por defecto)</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join("");

  const ayuda = document.querySelector("#cita-horario-ayuda");
  if (huecos.length === 0) {
    // Sin huecos no hay nada que reservar: se ofrece habilitar uno directamente.
    ayuda.textContent = "No hay horarios libres. Marca «Habilitar un horario nuevo» para publicar uno.";
    casillaNuevoHorario.checked = true;
    alternarNuevoHorario();
  } else {
    ayuda.textContent = `${huecos.length} horario${huecos.length === 1 ? "" : "s"} libre${huecos.length === 1 ? "" : "s"} a partir de hoy.`;
  }

  // Fecha por defecto: mañana, que es lo habitual al crear una cita.
  document.querySelector("#nuevo-fecha").value ||= sumarDias(hoy(), 1);
}

/** Muestra u oculta el bloque de horario nuevo. */
function alternarNuevoHorario() {
  camposNuevoHorario.hidden = !casillaNuevoHorario.checked;
  if (casillaNuevoHorario.checked) {
    document.querySelector("#nuevo-fecha").focus();
  }
}

casillaNuevoHorario.addEventListener("change", alternarNuevoHorario);

async function abrirDialogoCita() {
  formularioCita.reset();
  errorCita.hidden = true;
  mensajeNuevoHorario.textContent = "";
  camposNuevoHorario.hidden = true;

  try {
    await cargarOpcionesCita();
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  dialogoCita.showModal();
}

document.querySelector("#crear-cita").addEventListener("click", () => void abrirDialogoCita());
document.querySelector("#close-cita-dialog").addEventListener("click", () => dialogoCita.close());
document.querySelector("#cancel-cita-dialog").addEventListener("click", () => dialogoCita.close());

formularioCita.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorCita.hidden = false;
  errorCita.textContent = "";
  mensajeNuevoHorario.textContent = "";

  const datos = datosDe(formularioCita);
  if (!datos.clientId) {
    errorCita.textContent = "Elige el cliente de la cita.";
    errorCita.hidden = false;
    return;
  }

  const boton = formularioCita.querySelector('button[type="submit"]');
  boton.disabled = true;
  let horarioCreado = null;

  try {
    // Paso 1 (opcional): si se pidió, se publica el horario antes de reservar.
    // La cita no puede existir sin disponibilidad, y crear el hueco aquí evita
    // tener que ir al calendario en mitad del formulario.
    if (datos.nuevoHorario) {
      const publicado = await post("/api/availability", {
        date: datos.nuevaFecha,
        startTime: datos.nuevoInicio,
        endTime: datos.nuevoFin,
        status: datos.nuevoEstado || "AVAILABLE",
        note: datos.nuevoNota || null
      });
      horarioCreado = publicado.disponibilidad;

      // Si el horario se publica bloqueado no se puede reservar: se avisa en vez
      // de enviar una cita que el servidor va a rechazar.
      if (horarioCreado.status !== "AVAILABLE") {
        mensajeNuevoHorario.textContent =
          "Horario publicado como bloqueado: queda visible en el calendario pero no se puede reservar.";
        throw new Error("Un horario bloqueado no admite citas.");
      }
    } else if (!datos.availabilityId) {
      throw new Error("Elige un horario libre o habilita uno nuevo.");
    }

    // Paso 2: la cita, sobre el hueco elegido (nuevo o ya publicado).
    await post("/api/appointments", {
      clientId: Number(datos.clientId),
      availabilityId: Number(horarioCreado ? horarioCreado.id : datos.availabilityId),
      categoryId: datos.categoryId ? Number(datos.categoryId) : null,
      title: datos.title || null,
      note: datos.note || null,
      status: datos.status || "PENDING"
    });

    dialogoCita.close();
    toast(horarioCreado ? "Horario publicado y cita creada." : "Cita creada.");
    await cargar();
  } catch (error) {
    // Si se publicó un horario y la cita falla, se deja el horario como estaba:
    // borrarlo también sería datos que el admin ha pedido crear.
    errorCita.textContent = textoError(error);
    errorCita.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

await cargar();
