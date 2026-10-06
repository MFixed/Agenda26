import {
  anotar,
  cuerpoObjeto,
  idPositivo,
  lanzarSiHayErrores,
  opcional,
  soloCampos,
  texto
} from "./helpers.js";
import { esFechaISO, esHora } from "../utils/date.js";

/**
 * POST /api/appointments — el cliente solicita un servicio.
 *
 * El cliente elige el horario (availabilityId) y escribe la anotación. El título
 * y la categoría son opcionales: si no los manda, se usa la categoría SERVICIOS
 * (§15) y el título se deriva de ella. En ningún caso se manda clientId: la cita
 * es siempre del cliente que la solicita.
 */
export function parseSolicitudCita(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, new Set(["availabilityId", "categoryId", "title", "note"]), lista);

  const availabilityId = idPositivo(datos.availabilityId);
  if (!availabilityId) {
    anotar(lista, "availabilityId", "Elige un horario disponible.");
  }
  const categoryId = idPositivo(datos.categoryId);
  if (datos.categoryId !== undefined && datos.categoryId !== null && !categoryId) {
    anotar(lista, "categoryId", "Categoría no válida.");
  }
  const title = opcional(datos.title);
  if (title && title.length > 160) {
    anotar(lista, "title", "El título es demasiado largo (160 caracteres).");
  }
  const note = opcional(datos.note);
  if (note && note.length > 1000) {
    anotar(lista, "note", "La anotación es demasiado larga (1000 caracteres).");
  }

  lanzarSiHayErrores(lista, "Revisa la solicitud.");
  return {
    availabilityId,
    categoryId: categoryId || null,
    title: title || null,
    note
  };
}

/** POST /api/appointments — el administrador registra una cita por un cliente. */
export function parseCitaDeAdmin(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(
    datos,
    new Set(["clientId", "availabilityId", "categoryId", "title", "note", "status"]),
    lista
  );

  const clientId = idPositivo(datos.clientId);
  if (!clientId) {
    anotar(lista, "clientId", "Elige el cliente de la cita.");
  }
  const availabilityId = idPositivo(datos.availabilityId);
  if (!availabilityId) {
    anotar(lista, "availabilityId", "Elige un horario disponible.");
  }
  const categoryId = idPositivo(datos.categoryId);
  const title = opcional(datos.title);
  if (title && title.length > 160) {
    anotar(lista, "title", "El título es demasiado largo (160 caracteres).");
  }
  const note = opcional(datos.note);
  if (note && note.length > 1000) {
    anotar(lista, "note", "La anotación es demasiado larga (1000 caracteres).");
  }
  const status = texto(datos.status).toUpperCase() || "PENDING";
  if (!["PENDING", "COORDINATED"].includes(status)) {
    anotar(lista, "status", "Una cita nueva sólo puede empezar en PENDING o COORDINATED.");
  }

  lanzarSiHayErrores(lista, "Revisa los datos de la cita.");
  return { clientId, availabilityId, categoryId: categoryId || null, title: title || null, note, status };
}

/** PUT /api/appointments/:id — el administrador ajusta la cita (nota, horario, estado). */
export function parseActualizarCita(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, new Set(["note", "availabilityId", "status"]), lista);

  const cambios = {};
  if (datos.note !== undefined) {
    const note = opcional(datos.note);
    if (note && note.length > 1000) {
      anotar(lista, "note", "La anotación es demasiado larga (1000 caracteres).");
    }
    cambios.note = note;
  }
  if (datos.availabilityId !== undefined) {
    const availabilityId = idPositivo(datos.availabilityId);
    if (!availabilityId) {
      anotar(lista, "availabilityId", "Horario no válido.");
    }
    cambios.availabilityId = availabilityId;
  }
  if (datos.status !== undefined) {
    const status = texto(datos.status).toUpperCase();
    if (!["PENDING", "COORDINATED", "COMPLETED", "CANCELLED", "REJECTED"].includes(status)) {
      anotar(lista, "status", "Estado de cita desconocido.");
    }
    cambios.status = status;
  }

  lanzarSiHayErrores(lista, "Revisa los cambios de la cita.");
  return cambios;
}

/**
 * Filtros de listado: los usan /api/appointments y /api/tasks.
 * No se permiten fechas libres: si vienen mal, se ignoran en vez de romper.
 */
export function parseFiltros(query, { estadosValidos = [] } = {}) {
  const origen = query && typeof query === "object" ? query : {};
  const filtros = {
    estado: texto(origen.estado).toUpperCase(),
    filtro: texto(origen.filtro).toLowerCase(),
    // Alcance de la lista: "propias" (las que no nacen de una cita) o
    // "de-citas". Se combina con `filtro`, que luego acota dentro del alcance.
    alcance: texto(origen.alcance).toLowerCase(),
    q: texto(origen.q).slice(0, 120),
    desde: esFechaISO(texto(origen.desde)) ? texto(origen.desde) : null,
    hasta: esFechaISO(texto(origen.hasta)) ? texto(origen.hasta) : null,
    limit: Math.min(Math.max(Number.parseInt(origen.limit, 10) || 100, 1), 500),
    offset: Math.max(Number.parseInt(origen.offset, 10) || 0, 0)
  };

  if (filtros.estado && estadosValidos.length > 0 && !estadosValidos.includes(filtros.estado)) {
    filtros.estado = "";
  }
  return filtros;
}

export { esHora };
