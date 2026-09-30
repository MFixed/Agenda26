import { edad, esFechaISO } from "./date.js";

/**
 * Traducción de la base de datos al JSON de la API.
 *
 * Está en un único sitio a propósito: los nombres de campo en camelCase, las
 * fechas como "AAAA-MM-DD", las horas como "HH:mm" y las marcas de tiempo en ISO
 * 8601. Ningún controlador debería inventarse su propio formato, ni devolver un
 * Date crudo (que arrive como "2026-09-30T00:00:00.000Z" y haya que recortar en
 * el frontend).
 *
 * Ninguna de estas funciones incluye passwordHash.
 */

const soloFecha = (valor) => (valor instanceof Date ? valor.toISOString().slice(0, 10) : null);
const instante = (valor) => (valor instanceof Date ? valor.toISOString() : null);

export function usuarioPublico(usuario) {
  if (!usuario) {
    return null;
  }
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    role: usuario.role,
    activo: usuario.activo,
    ultimoAcceso: instante(usuario.ultimoAcceso),
    createdAt: instante(usuario.createdAt),
    updatedAt: instante(usuario.updatedAt)
  };
}

export function clientePublico(cliente, { conUsuario = false } = {}) {
  if (!cliente) {
    return null;
  }
  const fechaNacimiento = soloFecha(cliente.fechaNacimiento);
  return {
    id: cliente.id,
    userId: cliente.userId,
    nombre: cliente.nombre,
    documento: cliente.documento,
    fechaNacimiento,
    edad: fechaNacimiento && esFechaISO(fechaNacimiento) ? edad(fechaNacimiento) : null,
    telefono: cliente.telefono,
    direccion: cliente.direccion,
    createdAt: instante(cliente.createdAt),
    updatedAt: instante(cliente.updatedAt),
    ...(conUsuario && cliente.user ? { user: usuarioPublico(cliente.user) } : {})
  };
}

export function categoriaPublica(categoria, { conConteo = false } = {}) {
  if (!categoria) {
    return null;
  }
  return {
    id: categoria.id,
    name: categoria.name,
    description: categoria.description,
    ...(conConteo && typeof categoria._count === "object" ? { tareas: categoria._count.tasks } : {}),
    createdAt: instante(categoria.createdAt),
    updatedAt: instante(categoria.updatedAt)
  };
}

export function tareaPublica(tarea) {
  if (!tarea) {
    return null;
  }
  return {
    id: tarea.id,
    title: tarea.title,
    description: tarea.description,
    status: tarea.status,
    dueDate: soloFecha(tarea.dueDate),
    dueTime: tarea.dueTime,
    sinFecha: tarea.dueDate === null,
    categoryId: tarea.categoryId,
    category: tarea.category ? { id: tarea.category.id, name: tarea.category.name } : null,
    clientId: tarea.clientId,
    client: tarea.client ? { id: tarea.client.id, nombre: tarea.client.nombre } : null,
    ...(typeof tarea._count === "object" ? { citas: tarea._count.appointments } : {}),
    createdAt: instante(tarea.createdAt),
    updatedAt: instante(tarea.updatedAt)
  };
}

export function disponibilidadPublica(disponibilidad, { conCita = false } = {}) {
  if (!disponibilidad) {
    return null;
  }
  return {
    id: disponibilidad.id,
    date: soloFecha(disponibilidad.date),
    startTime: disponibilidad.startTime,
    endTime: disponibilidad.endTime,
    status: disponibilidad.status,
    note: disponibilidad.note,
    ...(conCita
      ? {
          cita: disponibilidad.appointments && disponibilidad.appointments[0]
            ? citaPublica(disponibilidad.appointments[0])
            : null
        }
      : {}),
    createdAt: instante(disponibilidad.createdAt),
    updatedAt: instante(disponibilidad.updatedAt)
  };
}

export function citaPublica(cita, { conRelaciones = true, conHistorial = false } = {}) {
  if (!cita) {
    return null;
  }
  const base = {
    id: cita.id,
    taskId: cita.taskId,
    clientId: cita.clientId,
    availabilityId: cita.availabilityId,
    note: cita.note,
    status: cita.status,
    createdAt: instante(cita.createdAt),
    updatedAt: instante(cita.updatedAt)
  };

  if (!conRelaciones) {
    return base;
  }

  return {
    ...base,
    task: cita.task
      ? {
          id: cita.task.id,
          title: cita.task.title,
          description: cita.task.description,
          status: cita.task.status,
          dueDate: soloFecha(cita.task.dueDate),
          dueTime: cita.task.dueTime,
          category: cita.task.category
            ? { id: cita.task.category.id, name: cita.task.category.name }
            : null
        }
      : null,
    client: cita.client
      ? {
          id: cita.client.id,
          nombre: cita.client.nombre,
          telefono: cita.client.telefono,
          email: cita.client.user ? cita.client.user.email : undefined
        }
      : null,
    availability: cita.availability
      ? {
          id: cita.availability.id,
          date: soloFecha(cita.availability.date),
          startTime: cita.availability.startTime,
          endTime: cita.availability.endTime,
          status: cita.availability.status,
          note: cita.availability.note
        }
      : null,
    ...(conHistorial && cita.events
      ? {
          historial: cita.events
            .map((evento) => ({
              id: evento.id,
              fromStatus: evento.fromStatus,
              toStatus: evento.toStatus,
              note: evento.note,
              actor: evento.actor ? { id: evento.actor.id, nombre: evento.actor.nombre } : null,
              createdAt: instante(evento.createdAt)
            }))
            .reverse()
        }
      : {}),
    ...(typeof cita._count === "object" ? { notificaciones: cita._count.notifications } : {})
  };
}

export function eventoPublico(evento) {
  return {
    id: evento.id,
    appointmentId: evento.appointmentId,
    fromStatus: evento.fromStatus,
    toStatus: evento.toStatus,
    note: evento.note,
    actor: evento.actor ? { id: evento.actor.id, nombre: evento.actor.nombre } : null,
    createdAt: instante(evento.createdAt)
  };
}

export function notificacionPublica(notificacion) {
  if (!notificacion) {
    return null;
  }
  return {
    id: notificacion.id,
    userId: notificacion.userId,
    appointmentId: notificacion.appointmentId,
    channel: notificacion.channel,
    type: notificacion.type,
    title: notificacion.title,
    message: notificacion.message,
    leida: notificacion.readAt !== null,
    readAt: instante(notificacion.readAt),
    createdAt: instante(notificacion.createdAt)
  };
}
