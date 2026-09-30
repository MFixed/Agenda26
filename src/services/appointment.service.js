import { prisma } from "../config/database.js";
import { conflicto, noEncontrado, prohibido } from "../utils/http.js";
import { formatearFechaES, hoyISO } from "../utils/date.js";
import { avisarAdmins, crearNotificacion } from "./notification.service.js";

/**
 * Servicio de citas: aquí viven las reglas del flujo de reserva (§11 y §12).
 *
 * EL BLOQUEO DE UN HORARIO
 * La fila de Availability es la que dice si un hueco está libre. Reservar es un
 * UPDATE condicional
 *
 *     UPDATE Availability SET status='HELD' WHERE id=? AND status='AVAILABLE'
 *
 * dentro de una transacción. Si otra petición cambió el estado antes, el UPDATE
 * no afecta a ninguna fila y la segunda reserva falla. Es un compare-and-swap, y
 * SQLite serializa las escrituras, así que dos clientes simultáneos no pueden
 * quedarse con el mismo hueco.
 *
 * Por eso Appointment.availabilityId NO lleva UNIQUE: un hueco rechazado o
 * cancelado tiene que poder volver a reservarse.
 */

const CATEGORIA_SERVICIOS = "SERVICIOS";

const CON_RELACIONES = {
  task: {
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      dueDate: true,
      dueTime: true,
      category: { select: { id: true, name: true } }
    }
  },
  client: { select: { id: true, nombre: true, telefono: true, user: { select: { email: true } } } },
  availability: {
    select: { id: true, date: true, startTime: true, endTime: true, status: true, note: true }
  }
};

const ESTADO_EN_PALABRAS = {
  PENDING: "pendiente de revisión",
  COORDINATED: "coordinada",
  COMPLETED: "completada",
  CANCELLED: "cancelada",
  REJECTED: "rechazada"
};

/**
 * Transiciones permitidas. Una cita confirmada no vuelve a "pendiente" sin pasar
 * por cancelada: el historial manda.
 */
const TRANSICIONES = {
  PENDING: ["COORDINATED", "REJECTED", "CANCELLED"],
  COORDINATED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: []
};

export function puedeTransicionar(desde, hasta) {
  return (TRANSICIONES[desde] || []).includes(hasta);
}

/* ------------------------------------------------------------------ *
 * Consultas
 * ------------------------------------------------------------------ */

/**
 * Un cliente sólo ve sus propias citas; el administrador las ve todas
 * (regla 8 y 10 de §12).
 */
export async function listarCitas(filtros, { clienteId }) {
  const condiciones = [];
  // El filtro de cliente se impone siempre: el admin acota si quiere, y un
  // cliente queda atado a su propio id sin excepción.
  if (clienteId) {
    // Ojo con el idioma: el parámetro se llama clienteId (español) y el campo
    // de Prisma clientId (inglés), así que la forma abreviada no valdría.
    condiciones.push({ clientId: clienteId });
  }
  if (filtros.estado) {
    condiciones.push({ status: filtros.estado });
  }
  if (filtros.desde || filtros.hasta) {
    condiciones.push({
      availability: {
        date: {
          ...(filtros.desde ? { gte: inicioDelDia(filtros.desde) } : {}),
          ...(filtros.hasta ? { lte: inicioDelDia(filtros.hasta) } : {})
        }
      }
    });
  }

  const where = condiciones.length > 0 ? { AND: condiciones } : undefined;
  const [total, items] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: CON_RELACIONES,
      orderBy: [{ createdAt: "desc" }],
      take: filtros.limit,
      skip: filtros.offset
    })
  ]);

  return { total, items };
}

export async function obtenerCita(id, { conHistorial = false } = {}) {
  const cita = await prisma.appointment.findUnique({
    where: { id },
    include: {
      ...CON_RELACIONES,
      ...(conHistorial
        ? {
            events: {
              include: { actor: { select: { id: true, nombre: true, role: true } } },
              orderBy: { createdAt: "desc" }
            }
          }
        : {})
    }
  });
  if (!cita) {
    throw noEncontrado("La cita no existe.");
  }
  return cita;
}

/** Regla 8 y 12: un cliente nunca ve la cita de otro, aunque cambie el id de la URL. */
export function exigirAcceso(cita, { esAdmin, clienteId }) {
  if (esAdmin) {
    return;
  }
  if (!clienteId || cita.clientId !== clienteId) {
    throw prohibido("Esta cita pertenece a otro cliente.");
  }
}

/** Ficha de un cliente, para las rutas /me que responden 404 si no existe. */
export async function obtenerClienteDeUsuario(userId) {
  return prisma.client.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, nombre: true, email: true, activo: true } },
      _count: { select: { appointments: true, tasks: true } }
    }
  });
}

/* ------------------------------------------------------------------ *
 * Reservar (pasos 1-3 del flujo)
 * ------------------------------------------------------------------ */

/**
 * Crea Task + Appointment y deja el hueco en HELD, de forma que otro cliente no
 * pueda ocuparlo mientras se revisa. Todo en una transacción (§25).
 */
export async function solicitarCita({ cliente, availabilityId, categoryId, title, note, actorId }) {
  return prisma.$transaction(async (tx) => {
    const disponibilidad = await tx.availability.findUnique({ where: { id: availabilityId } });
    if (!disponibilidad) {
      throw noEncontrado("El horario ya no existe.");
    }
    // Reglas 1, 2 y 3: sólo se reserva lo que está AVAILABLE.
    if (disponibilidad.status !== "AVAILABLE") {
      throw conflicto("Ese horario ya no está disponible.");
    }
    if (esPasado(disponibilidad.date)) {
      throw conflicto("Ese horario ya ha pasado.");
    }

    const categoria = await resolverCategoria(tx, categoryId);

    // Bloqueo atómico: si otra transacción se adelantó, count = 0.
    const bloqueo = await tx.availability.updateMany({
      where: { id: availabilityId, status: "AVAILABLE" },
      data: { status: "HELD" }
    });
    if (bloqueo.count === 0) {
      throw conflicto("Ese horario acaba de ocuparse.");
    }

    const tarea = await tx.task.create({
      data: {
        title: title || `${categoria ? categoria.name : "Servicio"} de ${cliente.nombre}`,
        // La tarea nace ligada al cliente que la pide (§15).
        clientId: cliente.id,
        categoryId: categoria ? categoria.id : null,
        status: "PENDING"
      }
    });

    const cita = await tx.appointment.create({
      data: { taskId: tarea.id, clientId: cliente.id, availabilityId, note, status: "PENDING" }
    });

    await tx.appointmentEvent.create({
      data: { appointmentId: cita.id, actorId: actorId ?? null, toStatus: "PENDING" }
    });

    const cuando = `${formatearFechaES(isoFecha(disponibilidad.date))} a las ${disponibilidad.startTime}`;

    await crearNotificacion(tx, {
      userId: cliente.userId,
      appointmentId: cita.id,
      type: "APPOINTMENT_REQUESTED",
      title: "Solicitud enviada",
      message: `Hemos recibido tu solicitud para el ${cuando}. Te avisaremos cuando la confirmemos.`
    });

    await avisarAdmins(tx, {
      appointmentId: cita.id,
      type: "NEW_REQUEST",
      title: "Nueva solicitud de cita",
      message: `${cliente.nombre} ha solicitado el ${cuando}.`
    });

    return tx.appointment.findUnique({ where: { id: cita.id }, include: CON_RELACIONES });
  });
}

/** El administrador puede registrar una cita por un cliente (PENDING o COORDINATED). */
export async function crearCitaDeAdmin({
  clientId,
  availabilityId,
  categoryId,
  title,
  note,
  status,
  actorId
}) {
  return prisma.$transaction(async (tx) => {
    const cliente = await tx.client.findUnique({ where: { id: clientId } });
    if (!cliente) {
      throw noEncontrado("El cliente no existe.");
    }

    const disponibilidad = await tx.availability.findUnique({ where: { id: availabilityId } });
    if (!disponibilidad) {
      throw noEncontrado("El horario ya no existe.");
    }
    if (disponibilidad.status !== "AVAILABLE") {
      throw conflicto("Ese horario ya no está disponible.");
    }

    const categoria = await resolverCategoria(tx, categoryId);
    const coordinada = status === "COORDINATED";

    const bloqueo = await tx.availability.updateMany({
      where: { id: availabilityId, status: "AVAILABLE" },
      data: { status: coordinada ? "RESERVED" : "HELD" }
    });
    if (bloqueo.count === 0) {
      throw conflicto("Ese horario acaba de ocuparse.");
    }

    const tarea = await tx.task.create({
      data: {
        title: title || `${categoria ? categoria.name : "Servicio"} de ${cliente.nombre}`,
        clientId: cliente.id,
        categoryId: categoria ? categoria.id : null
      }
    });

    const cita = await tx.appointment.create({
      data: {
        taskId: tarea.id,
        clientId: cliente.id,
        availabilityId,
        note,
        status: coordinada ? "COORDINATED" : "PENDING"
      }
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: cita.id,
        actorId,
        toStatus: cita.status,
        note: "Registrada por la administración."
      }
    });

    if (coordinada) {
      await crearNotificacion(tx, {
        userId: cliente.userId,
        appointmentId: cita.id,
        type: "APPOINTMENT_COORDINATED",
        title: "Tu cita está coordinada",
        message: `Tu cita queda el ${formatearFechaES(isoFecha(disponibilidad.date))} a las ${disponibilidad.startTime}.`
      });
    }

    return tx.appointment.findUnique({ where: { id: cita.id }, include: CON_RELACIONES });
  });
}

async function resolverCategoria(tx, categoryId) {
  if (categoryId) {
    return tx.category.findUnique({ where: { id: categoryId } });
  }
  return tx.category.findFirst({ where: { name: CATEGORIA_SERVICIOS } });
}

/* ------------------------------------------------------------------ *
 * Cambios de estado (paso 4 del flujo)
 * ------------------------------------------------------------------ */

/**
 * Confirma, rechaza, completa o cancela. En una sola transacción: comprobar la
 * transición, cambiar la cita, cambiar la disponibilidad, registrar el evento y
 * avisar. Si algo falla, no queda nada a medias.
 */
export async function cambiarEstadoCita({ citaId, nuevoEstado, actorId, note = null }) {
  return prisma.$transaction(async (tx) => {
    const cita = await tx.appointment.findUnique({
      where: { id: citaId },
      include: { client: true, availability: true, task: true }
    });
    if (!cita) {
      throw noEncontrado("La cita no existe.");
    }
    if (!puedeTransicionar(cita.status, nuevoEstado)) {
      throw conflicto(
        `Una cita ${ESTADO_EN_PALABRAS[cita.status]} no puede pasar a ${ESTADO_EN_PALABRAS[nuevoEstado]}.`
      );
    }

    if (nuevoEstado === "COORDINATED") {
      // Se mantiene el bloqueo, sólo pasa de HELD a RESERVED.
      await tx.availability.updateMany({
        where: { id: cita.availabilityId, status: { in: ["HELD", "RESERVED"] } },
        data: { status: "RESERVED" }
      });
    } else {
      // COMPLETED, CANCELLED y REJECTED liberan el hueco para reutilizarlo.
      const liberacion = await tx.availability.updateMany({
        where: { id: cita.availabilityId, status: { in: ["HELD", "RESERVED"] } },
        data: { status: "AVAILABLE" }
      });
      if (liberacion.count === 0) {
        throw conflicto("El horario de la cita no está bloqueado; revisa el estado.");
      }
    }

    await tx.appointment.update({
      where: { id: citaId },
      data: { status: nuevoEstado, ...(note !== null ? { note } : {}) }
    });

    await tx.appointmentEvent.create({
      data: { appointmentId: citaId, actorId, fromStatus: cita.status, toStatus: nuevoEstado, note }
    });

    // Al completarla, la tarea que la originó también se cierra.
    if (nuevoEstado === "COMPLETED" && cita.task.status !== "COMPLETED") {
      await tx.task.update({ where: { id: cita.taskId }, data: { status: "COMPLETED" } });
    }

    await crearNotificacion(tx, {
      userId: cita.client.userId,
      appointmentId: citaId,
      type: `APPOINTMENT_${nuevoEstado}`,
      title: `Tu cita está ${ESTADO_EN_PALABRAS[nuevoEstado]}`,
      message: mensajeParaCliente(cita, nuevoEstado)
    });

    if (nuevoEstado === "COORDINATED") {
      await avisarAdmins(tx, {
        appointmentId: citaId,
        type: "APPOINTMENT_COORDINATED",
        title: "Cita coordinada",
        message: `Has coordinado la cita de ${cita.client.nombre}.`
      });
    }

    return tx.appointment.findUnique({ where: { id: citaId }, include: CON_RELACIONES });
  });
}

function mensajeParaCliente(cita, nuevoEstado) {
  const cuando = `${formatearFechaES(isoFecha(cita.availability.date))} a las ${cita.availability.startTime}`;
  switch (nuevoEstado) {
    case "COORDINATED":
      return `Tu solicitud "${cita.task.title}" queda coordinada para el ${cuando}.`;
    case "REJECTED":
      return `Tu solicitud "${cita.task.title}" no se ha podido coordinar. Te avisaremos si hay otro hueco.`;
    case "CANCELLED":
      return `Tu cita "${cita.task.title}" del ${cuando} ha sido cancelada.`;
    case "COMPLETED":
      return `Tu cita "${cita.task.title}" se ha completado. Gracias.`;
    default:
      return `Tu cita "${cita.task.title}" ha cambiado de estado.`;
  }
}

/** El cliente cancela su propia cita pendiente y el hueco vuelve a quedar libre. */
export async function cancelarCitaDelCliente({ citaId, clienteId, actorId }) {
  return prisma.$transaction(async (tx) => {
    const cita = await tx.appointment.findUnique({
      where: { id: citaId },
      include: { client: true, availability: true, task: true }
    });
    if (!cita) {
      throw noEncontrado("La cita no existe.");
    }
    if (cita.clientId !== clienteId) {
      throw prohibido("Esta cita pertenece a otro cliente.");
    }
    if (cita.status !== "PENDING") {
      throw conflicto("Sólo puedes cancelar una cita que siga pendiente de revisión.");
    }

    const liberacion = await tx.availability.updateMany({
      where: { id: cita.availabilityId, status: "HELD" },
      data: { status: "AVAILABLE" }
    });
    if (liberacion.count === 0) {
      throw conflicto("El horario ya no está bloqueado por esta cita.");
    }

    await tx.appointment.update({ where: { id: citaId }, data: { status: "CANCELLED" } });
    await tx.appointmentEvent.create({
      data: {
        appointmentId: citaId,
        actorId,
        fromStatus: "PENDING",
        toStatus: "CANCELLED",
        note: "Cancelada por el cliente."
      }
    });

    await avisarAdmins(tx, {
      appointmentId: citaId,
      type: "APPOINTMENT_CANCELLED",
      title: "Cita cancelada por el cliente",
      message: `${cita.client.nombre} ha cancelado su cita de "${cita.task.title}". El hueco queda libre.`
    });

    return tx.appointment.findUnique({ where: { id: citaId }, include: CON_RELACIONES });
  });
}

/** El administrador reprograma: libera el hueco viejo y ocupa el nuevo, en una transacción. */
export async function reprogramarCita({ citaId, availabilityId, actorId, note = null }) {
  return prisma.$transaction(async (tx) => {
    const cita = await tx.appointment.findUnique({
      where: { id: citaId },
      include: { client: true, availability: true, task: true }
    });
    if (!cita) {
      throw noEncontrado("La cita no existe.");
    }
    if (cita.status !== "PENDING" && cita.status !== "COORDINATED") {
      throw conflicto("Sólo se puede reprogramar una cita pendiente o coordinada.");
    }
    if (cita.availabilityId === availabilityId) {
      throw conflicto("Es el mismo horario que ya tiene.");
    }

    const destino = await tx.availability.findUnique({ where: { id: availabilityId } });
    if (!destino) {
      throw noEncontrado("El horario nuevo no existe.");
    }
    if (destino.status !== "AVAILABLE") {
      throw conflicto("Ese horario ya no está disponible.");
    }

    const ocupacion = await tx.availability.updateMany({
      where: { id: availabilityId, status: "AVAILABLE" },
      data: { status: cita.status === "COORDINATED" ? "RESERVED" : "HELD" }
    });
    if (ocupacion.count === 0) {
      throw conflicto("Ese horario acaba de ocuparse.");
    }

    await tx.availability.updateMany({
      where: { id: cita.availabilityId, status: { in: ["HELD", "RESERVED"] } },
      data: { status: "AVAILABLE" }
    });

    await tx.appointment.update({
      where: { id: citaId },
      data: { availabilityId, ...(note !== null ? { note } : {}) }
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: citaId,
        actorId,
        fromStatus: cita.status,
        toStatus: cita.status,
        note: `Reprogramada al ${formatearFechaES(isoFecha(destino.date))} a las ${destino.startTime}.`
      }
    });

    await crearNotificacion(tx, {
      userId: cita.client.userId,
      appointmentId: citaId,
      type: "APPOINTMENT_RESCHEDULED",
      title: "Tu cita ha cambiado de horario",
      message: `Tu cita "${cita.task.title}" pasa al ${formatearFechaES(isoFecha(destino.date))} a las ${destino.startTime}.`
    });

    return tx.appointment.findUnique({ where: { id: citaId }, include: CON_RELACIONES });
  });
}

/** Ajuste de la anotación, sin tocar el estado. */
export async function editarCita({ citaId, cambios, actorId }) {
  return prisma.$transaction(async (tx) => {
    const cita = await tx.appointment.findUnique({ where: { id: citaId } });
    if (!cita) {
      throw noEncontrado("La cita no existe.");
    }
    if (cambios.availabilityId) {
      throw conflicto("Para cambiar el horario usa la reprogramación.");
    }

    await tx.appointment.update({
      where: { id: citaId },
      data: { note: cambios.note !== undefined ? cambios.note : cita.note }
    });

    if (cambios.note !== undefined && cambios.note !== cita.note) {
      await tx.appointmentEvent.create({
        data: {
          appointmentId: citaId,
          actorId,
          fromStatus: cita.status,
          toStatus: cita.status,
          note: "Anotación actualizada."
        }
      });
    }

    return tx.appointment.findUnique({ where: { id: citaId }, include: CON_RELACIONES });
  });
}

export async function eliminarCita(id) {
  const cita = await obtenerCita(id);
  return prisma.$transaction(async (tx) => {
    await tx.availability.updateMany({
      where: { id: cita.availabilityId, status: { in: ["HELD", "RESERVED"] } },
      data: { status: "AVAILABLE" }
    });
    return tx.appointment.delete({ where: { id } });
  });
}

/* ------------------------------------------------------------------ *
 * Resumen del panel de administración (§16)
 * ------------------------------------------------------------------ */

export async function resumenCitas() {
  const hoy = inicioDelDia(hoyISO());

  const [pendientes, coordinadas, completadas, canceladas, rechazadas, proximas, hoyCount] =
    await Promise.all([
      prisma.appointment.count({ where: { status: "PENDING" } }),
      prisma.appointment.count({ where: { status: "COORDINATED" } }),
      prisma.appointment.count({ where: { status: "COMPLETED" } }),
      prisma.appointment.count({ where: { status: "CANCELLED" } }),
      prisma.appointment.count({ where: { status: "REJECTED" } }),
      prisma.appointment.findMany({
        where: { status: { in: ["PENDING", "COORDINATED"] }, availability: { date: { gte: hoy } } },
        include: CON_RELACIONES,
        orderBy: { availability: { date: "asc" } },
        take: 5
      }),
      prisma.appointment.count({
        where: {
          status: { in: ["PENDING", "COORDINATED"] },
          availability: { date: hoy }
        }
      })
    ]);

  return { pendientes, coordinadas, completadas, canceladas, rechazadas, hoy: hoyCount, proximas };
}

/* ------------------------------------------------------------------ *
 * Utilidades locales
 * ------------------------------------------------------------------ */

function inicioDelDia(fechaISO) {
  return new Date(`${fechaISO}T00:00:00.000Z`);
}

function isoFecha(fecha) {
  return fecha instanceof Date ? fecha.toISOString().slice(0, 10) : null;
}

function esPasado(fecha) {
  return isoFecha(fecha) < hoyISO();
}
