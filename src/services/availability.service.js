import { prisma } from "../config/database.js";
import { conflicto, noEncontrado, prohibido } from "../utils/http.js";
import { aMedianocheUTC, hoyISO } from "../utils/date.js";

/**
 * Listado de horarios.
 *
 * El cliente y el administrador ven cosas distintas y por eso hay dos funciones
 * en lugar de una con bandera: el cliente sólo puede ver huecos libres y
 * futuros, el administrador ve todo lo que ha publicado, incluido lo pasado.
 */
export async function listarDisponibilidades({ desde, hasta, estado, conCita = false }, businessId) {
  const where = { businessId };
  if (desde || hasta) {
    where.date = {
      ...(desde ? { gte: aMedianocheUTC(desde) } : {}),
      ...(hasta ? { lte: aMedianocheUTC(hasta) } : {})
    };
  }
  if (estado) {
    where.status = estado;
  }

  return prisma.availability.findMany({
    where,
    include: conCita
      ? {
          appointments: {
            include: {
              client: { select: { id: true, nombre: true } },
              task: { select: { id: true, title: true } }
            },
            orderBy: { createdAt: "desc" }
          }
        }
      : { appointments: { select: { id: true, status: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  });
}

/** Huecos que un cliente puede pulsar: libres y a partir de hoy. */
export function listarHuecosReservables({ desde, hasta }, businessId) {
  const where = {
    businessId,
    status: "AVAILABLE",
    date: { gte: aMedianocheUTC(desde || hoyISO()) }
  };
  if (hasta) {
    where.date.lte = aMedianocheUTC(hasta);
  }

  return prisma.availability.findMany({
    where,
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  });
}

export async function obtenerDisponibilidad(id, { conCita = true } = {}, businessId = null) {
  const disponibilidad = await prisma.availability.findUnique({
    where: { id },
    include: conCita
      ? {
          appointments: {
            include: {
              client: { select: { id: true, nombre: true } },
              task: { select: { id: true, title: true } }
            },
            orderBy: { createdAt: "desc" }
          }
        }
      : undefined
  });
  if (!disponibilidad || (businessId !== null && disponibilidad.businessId !== businessId)) {
    throw noEncontrado("El horario no existe.");
  }
  return disponibilidad;
}

export async function crearDisponibilidad({ date, startTime, endTime, status, note }, businessId) {
  const inicio = aMedianocheUTC(date);
  const existente = await prisma.availability.findUnique({
    where: { businessId_date_startTime: { businessId, date: inicio, startTime } }
  });
  if (existente) {
    throw conflicto("Ya hay un horario publicado que empieza a esa hora.");
  }
  return prisma.availability.create({
    data: { date: inicio, startTime, endTime, status, note, businessId }
  });
}

/**
 * Editar un horario. No se puede tocar la fecha ni la hora de un hueco que ya
 * está reservado o en espera: primero hay que liberar la cita.
 */
export async function actualizarDisponibilidad(id, cambios, businessId) {
  const actual = await obtenerDisponibilidad(id, { conCita: true }, businessId);
  const ocupada = actual.status === "RESERVED" || actual.status === "HELD";
  const mueveHorario = cambios.date !== undefined || cambios.startTime !== undefined || cambios.endTime !== undefined;

  if (ocupada && mueveHorario) {
    throw conflicto("No puedes mover un horario reservado o en espera. Libera primero la cita.");
  }
  if (ocupada && cambios.status !== undefined && cambios.status !== actual.status) {
    throw conflicto(
      "Para liberar un horario con cita, cancela o rechaza la cita desde el detalle."
    );
  }

  const date = cambios.date !== undefined ? aMedianocheUTC(cambios.date) : undefined;
  const startTime = cambios.startTime;

  if (date !== undefined || startTime !== undefined) {
    const destino = await prisma.availability.findUnique({
      where: {
        businessId_date_startTime: { businessId, date: date ?? actual.date, startTime: startTime ?? actual.startTime }
      }
    });
    if (destino && destino.id !== id) {
      throw conflicto("Ya hay un horario publicado que empieza a esa hora.");
    }
  }

  return prisma.availability.update({
    where: { id },
    data: {
      date,
      startTime: cambios.startTime,
      endTime: cambios.endTime,
      status: cambios.status,
      note: cambios.note
    }
  });
}

export async function eliminarDisponibilidad(id, businessId) {
  const actual = await obtenerDisponibilidad(id, { conCita: true }, businessId);
  if (actual.status === "RESERVED" || actual.status === "HELD") {
    throw conflicto("No se puede borrar un horario con una cita asociada.");
  }
  return prisma.availability.delete({ where: { id } });
}
