/**
 * Calendario del administrador: vista mensual (días con su carga) y vista
 * semanal (agenda por día).
 *
 * LO QUE SE UNIFICA
 * Un horario publicado y la cita que tiene detrás son la misma cosa en un
 * calendario. Antes se pintaban como dos apartados, así que una cita confirmada
 * ocupaba dos filas y el mes iba lleno de contadores que además se contaban dos
 * veces: el hueco reservado salía como "cita" y como "reservado". Aquí cada
 * horario es una fila, y la cita se pinta dentro de su fila.
 *
 * Los datos vienen de tres endpoints ya existentes —availability, appointments y
 * tasks— filtrados por rango de fechas. No hay endpoint de calendario: el
 * calendario es una composición de lectura.
 *
 * Aquí se consulta y se edita lo ya publicado. Publicar horarios nuevos es cosa
 * del panel principal.
 */
import {
  ESTADOS_CITA,
  ESTADOS_HUECO,
  ESTADOS_TAREA,
  conectarSalir,
  datosDe,
  del,
  esc,
  exigirSesion,
  fecha,
  get,
  hoy,
  lunesDe,
  put,
  sumarDias,
  toast,
  textoError
} from "../api.js";
import { confirmar, dato, montarCabecera } from "../ui.js";
import { abrirCita } from "./cita-modal.js";

const sesion = await exigirSesion("ADMIN");
montarCabecera(sesion);
conectarSalir();

const estado = {
  vista: "mes",
  ancla: hoy()
};

const contenedor = document.querySelector("#calendario");
const mensaje = document.querySelector("#calendario-message");
const dialogoDia = document.querySelector("#dia-dialog");
const dialogoHueco = document.querySelector("#hueco-dialog");
const formularioHueco = document.querySelector("#hueco-form");
const errorHueco = document.querySelector("#hueco-error");

/* ---------------- Rango según la vista ---------------- */

function rango() {
  if (estado.vista === "semana") {
    const desde = lunesDe(estado.ancla);
    return { desde, hasta: sumarDias(desde, 6) };
  }
  // Mes: del lunes de la primera semana al domingo de la última.
  const [anio, mes] = estado.ancla.split("-").map(Number);
  const primero = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const ultimo = `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return { desde: lunesDe(primero), hasta: sumarDias(lunesDe(ultimo), 6) };
}

function tituloPeriodo() {
  if (estado.vista === "semana") {
    const { desde, hasta } = rango();
    return `${fecha(desde)} – ${fecha(hasta)}`;
  }
  const [anio, mes] = estado.ancla.split("-").map(Number);
  return new Date(anio, mes - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function mover(paso) {
  if (estado.vista === "semana") {
    estado.ancla = sumarDias(estado.ancla, paso * 7);
  } else {
    const [anio, mes] = estado.ancla.split("-").map(Number);
    const nuevo = new Date(anio, mes - 1 + paso, 1);
    estado.ancla = `${nuevo.getFullYear()}-${String(nuevo.getMonth() + 1).padStart(2, "0")}-01`;
  }
}

/* ---------------- Datos ---------------- */

async function cargar() {
  const { desde, hasta } = rango();
  contenedor.innerHTML = '<p class="muted">Cargando…</p>';
  mensaje.textContent = "";
  document.querySelector("#periodo-titulo").textContent = tituloPeriodo();

  try {
    // Sólo las tareas propias del administrador: las que nacen de una cita ya
    // salen en la fila de esa cita, y en el mismo día se verían duplicadas.
    const [citas, huecos, tareas] = await Promise.all([
      get(`/api/appointments?desde=${desde}&hasta=${hasta}&limit=500`),
      get(`/api/availability?desde=${desde}&hasta=${hasta}`),
      get(`/api/tasks?alcance=propias&filtro=agendadas&limit=500&desde=${desde}&hasta=${hasta}`)
    ]);

    const porDia = agrupar({ citas: citas.items, huecos: huecos.items, tareas: tareas.items });
    // El editor de un horario necesita el hueco entero, y sólo lo tenemos aquí.
    // Se guarda todo el rango de una vez, no al abrir cada día, para que también
    // funcione desde la vista semanal.
    guardarHuecos(porDia);
    contenedor.innerHTML = estado.vista === "mes" ? pintarMes(porDia, desde) : pintarSemana(porDia, desde);
    conectarDias(porDia);
  } catch (error) {
    contenedor.innerHTML = "";
    mensaje.textContent = textoError(error);
    mensaje.classList.add("error");
  }
}

/* ------------------------------------------------------------------ *
 * La agenda: una fila por horario publicado
 * ------------------------------------------------------------------ */

/**
 * Un mismo hueco puede tener varias citas a lo largo del tiempo: una que se
 * rechazó y otra que se confirmó, por ejemplo. Gana la que está más viva, que
 * es la que de verdad ocupa el horario.
 */
const MAS_VIVA = { PENDING: 0, COORDINATED: 1, COMPLETED: 2, CANCELLED: 3, REJECTED: 4 };

/**
 * Fusiona huecos y citas en una agenda. Cada horario es una fila; si tiene cita
 * detrás, la fila la muestra. Los huecos libres y los bloqueados también son
 * filas, pero del mismo tipo, para que leer un día sea leer una línea de tiempo.
 *
 * Una cita cancelada o rechazada devuelve el hueco a la lista de libres, así que
 * la fila se pinta como libre pero conservando la constancia de lo que pasó.
 */
function agendaDelDia({ citas, huecos }) {
  const citaDeHueco = new Map();
  for (const cita of citas) {
    const previa = citaDeHueco.get(cita.availabilityId);
    if (!previa || MAS_VIVA[cita.status] < MAS_VIVA[previa.status]) {
      citaDeHueco.set(cita.availabilityId, cita);
    }
  }

  return huecos
    .map((hueco) => {
      const cita = citaDeHueco.get(hueco.id) || null;
      // Cancelada o rechazada ya no ocupa: el hueco quedó libre otra vez.
      const cerrada = cita?.status === "CANCELLED" || cita?.status === "REJECTED";

      return {
        hueco,
        cita,
        hora: hueco.startTime,
        tipo: !cita ? (hueco.status === "AVAILABLE" ? "libre" : "bloqueado") : cerrada ? "libre" : "cita",
        titulo: cita ? cita.task?.title || "Cita" : "",
        meta: cita
          ? [ESTADOS_CITA[cita.status]?.texto || cita.status, cita.client?.nombre || ""]
          : [hueco.status === "AVAILABLE" ? "Libre" : "Bloqueado", hueco.note || ""]
      };
    })
    .sort((a, b) => a.hora.localeCompare(b.hora));
}

/** Agrupa por fecha ISO y deja cada día con su agenda ya montada. */
function agrupar({ citas, huecos, tareas }) {
  const crudos = new Map();
  const dia = (clave) => {
    if (!crudos.has(clave)) {
      crudos.set(clave, { citas: [], huecos: [], tareas: [] });
    }
    return crudos.get(clave);
  };

  for (const cita of citas) {
    const fecha = cita.availability?.date;
    if (fecha) dia(fecha).citas.push(cita);
  }
  for (const hueco of huecos) {
    dia(hueco.date).huecos.push(hueco);
  }
  for (const tarea of tareas) {
    // Sin fecha no tiene día donde colocar: se ve en "Tareas sin fecha".
    if (tarea.dueDate) dia(tarea.dueDate).tareas.push(tarea);
  }

  const porDia = new Map();
  for (const [clave, contenido] of crudos) {
    porDia.set(clave, { agenda: agendaDelDia(contenido), tareas: contenido.tareas });
  }
  return porDia;
}

function contenidoDe(porDia, dia) {
  return porDia.get(dia) || { agenda: [], tareas: [] };
}

/** Cifras de un día, sin repetir nada: cada horario cuenta una sola vez. */
function resumen(agenda, tareas = 0) {
  return {
    citas: agenda.filter((fila) => fila.tipo === "cita").length,
    libres: agenda.filter((fila) => fila.tipo === "libre").length,
    bloqueados: agenda.filter((fila) => fila.tipo === "bloqueado").length,
    tareas
  };
}

/* ------------------------------------------------------------------ *
 * Piezas de la agenda, compartidas por el mes, la semana y el detalle
 * ------------------------------------------------------------------ */

/**
 * Una fila de horario. Con cita abre la cita; sin cita, abre el editor.
 * El tipo lo decide la agenda y no el hecho de que haya cita: una cita
 * rechazada o cancelada devuelve el hueco a la lista de libres, así que se
 * pinta y se ordena como lo que ahora es.
 */
function filaAgenda(fila) {
  const { hueco, cita, tipo, titulo, meta, hora } = fila;
  const [estadoTexto, extra] = meta;

  const cuerpo = `
    <span class="agenda-cuerpo">
      <strong>${esc(titulo || estadoTexto)}</strong>
      ${extra ? `<small>${esc([estadoTexto, extra].filter(Boolean).join(" · "))}</small>` : ""}
    </span>`;

  const horaCol = `<span class="agenda-hora">${esc(hora)}–${esc(hueco.endTime)}</span>`;

  return cita
    ? `<li>
        <button class="agenda-row agenda-row--${tipo}" type="button" data-cita="${cita.id}">
          ${horaCol}${cuerpo}
        </button>
      </li>`
    : `<li>
        <button class="agenda-row agenda-row--${tipo}" type="button" data-hueco="${hueco.id}">
          ${horaCol}${cuerpo}
        </button>
      </li>`;
}

function filaTarea(tarea) {
  return `
    <li>
      <span class="agenda-row agenda-row--tarea${tarea.status === "COMPLETED" ? " agenda-row--hecha" : ""}">
        <span class="agenda-hora">${esc(tarea.dueTime || "—")}</span>
        <span class="agenda-cuerpo">
          <strong>${esc(tarea.title)}</strong>
          <small>${esc([tarea.category?.name || "Sin categoría", ESTADOS_TAREA[tarea.status]?.texto || tarea.status].join(" · "))}</small>
        </span>
      </span>
    </li>`;
}

/** "3 citas"; con 0 devuelve cadena vacía, para no pintar "0 tareas". */
const plural = (n, singular, plural) => (n > 0 ? `${n} ${n === 1 ? singular : plural}` : "");

/* ------------------------------------------------------------------ *
 * Vista mensual
 * ------------------------------------------------------------------ */

/**
 * Cada día es una casilla con el número y una línea de marcas: cuántas citas
 * tiene, cuántos horarios quedan libres y cuántas tareas hay. Ni los contadores
 * se repiten ni el texto se parte en dos líneas, que es lo que hacía la vista
 * mensual tan alta.
 */
function pintarMes(porDia, desde) {
  const hoyISO = hoy();
  const dias = Array.from({ length: 42 }, (_, indice) => sumarDias(desde, indice));

  const celdas = dias
    .map((dia) => {
      const { agenda, tareas } = contenidoDe(porDia, dia);
      const { citas, libres, bloqueados, tareas: totalTareas } = resumen(agenda, tareas.length);
      const mesActual = dia.slice(0, 7) === estado.ancla.slice(0, 7);

      const marcas = [
        citas ? `<i class="calendar-mark calendar-mark--cita">${citas}</i>` : "",
        libres ? `<i class="calendar-mark calendar-mark--libre">${libres}</i>` : "",
        totalTareas ? `<i class="calendar-mark calendar-mark--tarea">${totalTareas}</i>` : ""
      ]
        .filter(Boolean)
        .join("");

      // El texto largo va en el title y en el aria-label: la casilla en pantalla
      // sólo necesita los números.
      const detalle =
        [
          plural(citas, "cita", "citas"),
          plural(libres, "libre", "libres"),
          plural(bloqueados, "bloqueado", "bloqueados"),
          plural(totalTareas, "tarea", "tareas")
        ]
          .filter(Boolean)
          .join(" · ") || "sin nada programado";

      const conCita = citas > 0 || bloqueados > 0;

      return `
        <button class="calendar-day${mesActual ? "" : " other"}${dia === hoyISO ? " today" : ""}${conCita ? " busy" : ""}"
                type="button" data-dia="${dia}"
                title="${esc(`${fecha(dia)} · ${detalle}`)}"
                aria-label="${esc(`${fecha(dia)}: ${detalle}`)}">
          <span class="calendar-day-number">${Number(dia.slice(8))}</span>
          ${marcas ? `<span class="calendar-marks">${marcas}</span>` : ""}
        </button>`;
    })
    .join("");

  return `
    <div class="calendar-weekdays">
      <span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span>
    </div>
    <div class="calendar-grid">${celdas}</div>`;
}

/* ------------------------------------------------------------------ *
 * Vista semanal
 * ------------------------------------------------------------------ */

/**
 * Un día es una línea de tiempo: primero lo ocupado, que es lo que hay que
 * atender, y al final los horarios libres plegados en una línea. Se despliegan
 * con el propio <details>, sin estado en JavaScript.
 */
function pintarSemana(porDia, desde) {
  const hoyISO = hoy();
  const etiquetas = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  const dias = Array.from({ length: 7 }, (_, indice) => sumarDias(desde, indice))
    .map((dia, indice) => {
      const { agenda, tareas } = contenidoDe(porDia, dia);
      const { citas, libres, bloqueados } = resumen(agenda, tareas.length);

      const ocupados = agenda.filter((fila) => fila.tipo !== "libre");
      const sueltos = agenda.filter((fila) => fila.tipo === "libre");
      // Primero lo ocupado, que es lo que hay que atender, y detrás las tareas.
      const lineas = ocupados.map(filaAgenda).concat(tareas.map(filaTarea));

      const cuentas = [
        plural(citas, "cita", "citas"),
        plural(bloqueados, "bloqueado", "bloqueados"),
        plural(tareas.length, "tarea", "tareas")
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <section class="week-day">
          <h3>
            <span class="week-day-name">${etiquetas[indice]}</span>
            <small>${esc(fecha(dia))}</small>
            ${dia === hoyISO ? '<span class="chip">hoy</span>' : ""}
            ${cuentas ? `<span class="week-day-counts">${esc(cuentas)}</span>` : ""}
          </h3>

          ${
            lineas.length > 0
              ? `<ul class="agenda-list">${lineas.join("")}</ul>`
              : ""
          }

          ${
            sueltos.length > 0
              ? `<details class="agenda-libres">
                  <summary>${plural(sueltos.length, "horario libre", "horarios libres")}</summary>
                  <ul class="agenda-list">${sueltos.map(filaAgenda).join("")}</ul>
                </details>`
              : ""
          }

          ${
            lineas.length === 0 && sueltos.length === 0
              ? '<p class="week-vacio">Sin nada programado.</p>'
              : ""
          }
        </section>`;
    })
    .join("");

  return `<div class="week-list">${dias}</div>`;
}

/* ---------------- Detalle del día ---------------- */

function conectarDias(porDia) {
  for (const elemento of contenedor.querySelectorAll("[data-dia]")) {
    elemento.addEventListener("click", () => abrirDia(elemento.dataset.dia, porDia));
  }
  conectarFilas(contenedor);
}

/** Los clics de la agenda, tanto en la semana como dentro del <details>. */
function conectarFilas(donde) {
  for (const elemento of donde.querySelectorAll("[data-cita]")) {
    elemento.addEventListener("click", () => void abrirCita(Number(elemento.dataset.cita), { alCambiar: cargar }));
  }
  for (const elemento of donde.querySelectorAll("[data-hueco]")) {
    elemento.addEventListener("click", () => {
      const hueco = buscarHueco(Number(elemento.dataset.hueco));
      if (hueco) {
        abrirEditorHueco(hueco);
      }
    });
  }
}

let huecosEnMemoria = new Map();
/** Índice de horarios del rango cargado, para abrir el editor sin volver a pedir. */
function guardarHuecos(porDia) {
  huecosEnMemoria = new Map();
  for (const { agenda } of porDia.values()) {
    for (const fila of agenda) {
      huecosEnMemoria.set(fila.hueco.id, fila.hueco);
    }
  }
}
function buscarHueco(id) {
  return huecosEnMemoria.get(id) || null;
}

function abrirDia(dia, porDia) {
  const { agenda, tareas } = contenidoDe(porDia, dia);

  const { citas, libres, bloqueados } = resumen(agenda, tareas.length);
  // Los libres van al final y plegados, igual que en la semana.
  const ocupados = agenda.filter((fila) => fila.tipo !== "libre");
  const sueltos = agenda.filter((fila) => fila.tipo === "libre");

  const hayAlgo = agenda.length > 0 || tareas.length > 0;

  const contenidoDialogo = document.querySelector("#dia-contenido");
  contenidoDialogo.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Día</p>
        <h2 id="dia-dialog-title">${esc(fecha(dia))}</h2>
      </div>
      <button class="icon-button" data-cerrar type="button" aria-label="Cerrar">×</button>
    </div>

    <div class="detail-grid">
      ${dato("Citas", String(citas))}
      ${dato("Libres", String(libres))}
      ${dato("Tareas", String(tareas.length))}
      ${bloqueados ? dato("Bloqueados", String(bloqueados)) : ""}
    </div>

    ${
      hayAlgo
        ? `<ul class="agenda-list">${ocupados.map(filaAgenda).join("")}${tareas.map(filaTarea).join("")}</ul>`
        : '<p class="muted">No hay nada programado ni publicado este día.</p>'
    }

    ${
      sueltos.length > 0
        ? `<details class="agenda-libres" open>
            <summary>${plural(sueltos.length, "horario libre", "horarios libres")}</summary>
            <ul class="agenda-list">${sueltos.map(filaAgenda).join("")}</ul>
          </details>`
        : ""
    }
  `;

  contenidoDialogo.querySelector("[data-cerrar]").addEventListener("click", () => dialogoDia.close());
  conectarFilas(contenidoDialogo);

  dialogoDia.showModal();
}

/* ---------------- Editor de hueco ---------------- */

/**
 * Editor de un horario ya publicado. Sólo edita: publicar horarios nuevos se
 * hace desde el panel principal, que es donde vive esa acción.
 */
function abrirEditorHueco(hueco) {
  formularioHueco.reset();
  errorHueco.hidden = true;

  document.querySelector("#hueco-id").value = hueco.id;
  document.querySelector("#hueco-dialog-title").textContent = "Editar horario";
  document.querySelector("#hueco-fecha").value = hueco.date;
  document.querySelector("#hueco-inicio").value = hueco.startTime;
  document.querySelector("#hueco-fin").value = hueco.endTime;
  document.querySelector("#hueco-estado").value =
    hueco.status === "BLOCKED" ? "BLOCKED" : "AVAILABLE";
  document.querySelector("#hueco-nota").value = hueco.note || "";

  dialogoHueco.showModal();
}

formularioHueco.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorHueco.hidden = true;
  if (!formularioHueco.reportValidity()) {
    return;
  }

  const id = document.querySelector("#hueco-id").value;
  const datos = datosDe(formularioHueco);

  try {
    await put(`/api/availability/${id}`, datos);
    dialogoHueco.close();
    toast("Horario actualizado.");
    await cargar();
  } catch (error) {
    errorHueco.textContent = textoError(error);
    errorHueco.hidden = false;
  }
});

document.querySelector("#close-hueco-dialog").addEventListener("click", () => dialogoHueco.close());
document.querySelector("#cancel-hueco-dialog").addEventListener("click", () => dialogoHueco.close());

/**
 * Borrar un horario vive aquí y no en cada fila de la agenda: es una acción
 * rara y una fila con tres botones ocupa el triple. El backend impide borrar un
 * hueco con cita detrás, así que el aviso sale de ahí.
 */
document.querySelector("#borrar-hueco").addEventListener("click", async () => {
  const id = Number(document.querySelector("#hueco-id").value);
  const hueco = buscarHueco(id);
  if (!hueco) {
    return;
  }

  const ok = await confirmar({
    titulo: "Eliminar horario",
    texto: `Se eliminará el horario ${hueco.startTime}–${hueco.endTime} del ${fecha(hueco.date)}.`,
    aviso: "Si tiene una cita asociada no se puede eliminar.",
    textoBoton: "Eliminar"
  });
  if (!ok) {
    return;
  }

  try {
    await del(`/api/availability/${id}`);
    dialogoHueco.close();
    toast("Horario eliminado.");
    await cargar();
  } catch (error) {
    toast(textoError(error), true);
  }
});

/* ---------------- Controles ---------------- */

document.querySelector("#anterior").addEventListener("click", () => {
  mover(-1);
  void cargar();
});
document.querySelector("#siguiente").addEventListener("click", () => {
  mover(1);
  void cargar();
});
document.querySelector("#hoy").addEventListener("click", () => {
  estado.ancla = hoy();
  void cargar();
});
document.querySelector("#vista-mes").addEventListener("click", () => {
  estado.vista = "mes";
  estado.ancla = `${estado.ancla.slice(0, 7)}-01`;
  void cargar();
});
document.querySelector("#vista-semana").addEventListener("click", () => {
  estado.vista = "semana";
  void cargar();
});

await cargar();
