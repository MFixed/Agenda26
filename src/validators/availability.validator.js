import {
  anotar,
  cuerpoObjeto,
  fechaISOoLista,
  horaValida,
  idPositivo,
  lanzarSiHayErrores,
  opcional,
  soloCampos,
  texto
} from "./helpers.js";
import { hoyISO, horaEsAnterior } from "../utils/date.js";

const ESTADOS = ["AVAILABLE", "BLOCKED"];
const CAMPOS = new Set(["date", "startTime", "endTime", "status", "note"]);

function validarEstado(lista, valor, porDefecto = "AVAILABLE") {
  if (valor === undefined || valor === null || valor === "") {
    return porDefecto;
  }
  const status = texto(valor).toUpperCase();
  if (!ESTADOS.includes(status)) {
    // Al editar, un horario ya RESERVED o HELD vuelve a AVAILABLE si el admin
    // lo libera a mano; por eso se admiten los cuatro.
    if (!["RESERVED", "HELD"].includes(status)) {
      anotar(lista, "status", "Usa AVAILABLE, BLOCKED, RESERVED o HELD.");
      return porDefecto;
    }
  }
  return status;
}

function validarNota(lista, valor) {
  const note = opcional(valor);
  if (note && note.length > 200) {
    anotar(lista, "note", "La nota es demasiado larga (200 caracteres).");
  }
  return note;
}

/**
 * POST /api/availability — el administrador publica un horario.
 *
 * Reglas comprobadas aquí (las de negocio siguen en el service):
 *   - la hora de fin va después de la de inicio
 *   - la duración máxima es de 4 horas, para que un hueco no se reserve todo el día
 */
export function parseDisponibilidad(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, CAMPOS, lista);

  const date = fechaISOoLista(lista, "date", datos.date, { requerido: true });
  const startTime = horaValida(lista, "startTime", datos.startTime, { requerido: true });
  const endTime = horaValida(lista, "endTime", datos.endTime, { requerido: true });
  const status = validarEstado(lista, datos.status);
  const note = validarNota(lista, datos.note);

  if (date && date < hoyISO()) {
    anotar(lista, "date", "No se puede publicar disponibilidad en el pasado.");
  }
  if (startTime && endTime && !horaEsAnterior(startTime, endTime)) {
    anotar(lista, "endTime", "La hora de fin debe ser posterior a la de inicio.");
  }
  if (startTime && endTime && horaEsAnterior(startTime, endTime)) {
    const [h, m] = startTime.split(":").map(Number);
    const [h2, m2] = endTime.split(":").map(Number);
    if (h2 * 60 + m2 - (h * 60 + m) > 240) {
      anotar(lista, "endTime", "Un horario no puede durar más de 4 horas.");
    }
  }

  lanzarSiHayErrores(lista, "Revisa los datos de la disponibilidad.");
  return { date, startTime, endTime, status, note };
}

/** PUT /api/availability/:id — cambiar fecha, horas, nota o estado. */
export function parseActualizarDisponibilidad(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, CAMPOS, lista);

  const cambios = {};
  if (datos.date !== undefined) {
    cambios.date = fechaISOoLista(lista, "date", datos.date, { requerido: true });
  }
  if (datos.startTime !== undefined) {
    cambios.startTime = horaValida(lista, "startTime", datos.startTime, { requerido: true });
  }
  if (datos.endTime !== undefined) {
    cambios.endTime = horaValida(lista, "endTime", datos.endTime, { requerido: true });
  }
  if (datos.status !== undefined) {
    cambios.status = validarEstado(lista, datos.status);
  }
  if (datos.note !== undefined) {
    cambios.note = validarNota(lista, datos.note);
  }

  if (cambios.startTime && cambios.endTime && !horaEsAnterior(cambios.startTime, cambios.endTime)) {
    anotar(lista, "endTime", "La hora de fin debe ser posterior a la de inicio.");
  }
  if (cambios.date && cambios.date < hoyISO()) {
    anotar(lista, "date", "No se puede dejar disponibilidad en el pasado.");
  }

  lanzarSiHayErrores(lista, "Revisa los datos de la disponibilidad.");
  return cambios;
}

export { idPositivo, ESTADOS as ESTADOS_DISPONIBILIDAD };
