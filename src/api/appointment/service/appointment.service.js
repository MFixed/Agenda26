import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';
import { formatDateOnly, hoyLocal, parseDateOnly } from '../../../utils/dates.js';
import { pagination } from '../../../utils/pagination.js';
import { avisarCitaCoordinada } from '../../notification/service/email.service.js';
import { ESTADO_POR_ACCION, OCUPAN, TRANSITIONS } from '../appointment.regex.js';

const INCLUDE = {
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      category: { select: { id: true, name: true } },
    },
  },
  client: { select: { id: true, nombre: true, telefono: true, user: { select: { id: true, email: true } } } },
  availability: { select: { id: true, date: true, startTime: true, endTime: true, status: true } },
  business: { select: { id: true, nombre: true } },
};

const HISTORIAL = {
  orderBy: { createdAt: 'asc' },
  include: { actor: { select: { id: true, nombre: true, role: true } } },
};

/** Estado de la tarea que hay detras de la cita cuando la cita se cierra. */
const TAREA_AL_CERRAR = { COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', REJECTED: 'CANCELLED' };

/**
 * Estados que devuelven el bloque a la bolsa al cerrarse la cita.
 *
 * COMPLETED **no** esta aqui, y esa es toda la diferencia con lo que hacia antes:
 * una cita completada se realizo, ese rato se consumio, y devolver el bloque a
 * AVAILABLE lo ponia otra vez a la venta para el mismo dia y hora. Ahora queda en
 * RESERVED: el cliente ya no lo ve (el filtro de agenda solo muestra AVAILABLE) y
 * una reserva nueva encima da 409.
 *
 * CANCELLED y REJECTED si lo sueltan: la cita no llego a celebrarse y el horario
 * es real que vuelve a estar libre.
 */
const LIBERAN_HUECO = ['CANCELLED', 'REJECTED'];

/**
 * Estados que impiden devolver un bloque a AVAILABLE mientras exista la cita que
 * lo consume. Es OCUPAN mas COMPLETED, y la razon de tratarlos igual es que los
 * dos dejan la franja inutilizable: uno porque hay gente esperando, otro porque
 * ya se uso.
 */
const RETIENEN_HUECO = [...OCUPAN, 'COMPLETED'];

/**
 * Como la pinta el frontend. La cita se lee siempre a traves de su tarea (el
 * servicio), su cliente y su horario, y el historial se trae ya montado para
 * que el detalle no necesite una segunda peticion.
 */
function citaView({ client, availability, events, ...cita }) {
  return {
    ...cita,
    client: {
      id: client.id,
      nombre: client.nombre,
      telefono: client.telefono,
      email: client.user?.email ?? null,
    },
    availability: { ...availability, date: formatDateOnly(availability.date) },
    historial: (events ?? []).map((evento) => ({
      id: evento.id,
      fromStatus: evento.fromStatus,
      toStatus: evento.toStatus,
      note: evento.note,
      createdAt: evento.createdAt,
      actor: evento.actor,
    })),
  };
}

/**
 * Relee la cita dentro de la transaccion que la acaba de escribir. Hace falta
 * porque las escrituras van encadenadas (reservar el horario, cerrar la tarea,
 * apuntar el evento) y lo que devuelve la llamada inicial es el estado de antes
 * de ellas: responder con eso seria ensenarle al frontend un horario libre que
 * acaba de ocuparse.
 */
async function releer(tx, id) {
  const cita = await tx.appointment.findUnique({
    where: { id },
    include: { ...INCLUDE, events: HISTORIAL },
  });

  return citaView(cita);
}

/**
 * Filtro de la lista. El texto busca por cliente y por servicio a la vez, que
 * es lo que promete el buscador ("buscar por cliente o servicio").
 */
function whereDe(user, businessId, filtros = {}) {
  const texto = String(filtros.q || '').trim();

  return {
    businessId,
    // El cliente nunca filtra por otro clientId: solo ve los suyos.
    ...(user.role === 'CLIENT' ? { clientId: user.clientId } : {}),
    ...(user.role !== 'CLIENT' && filtros.clientId ? { clientId: filtros.clientId } : {}),
    ...(filtros.estado ? { status: filtros.estado } : {}),
    ...(texto
      ? {
          OR: [
            { client: { nombre: { contains: texto } } },
            { task: { title: { contains: texto } } },
          ],
        }
      : {}),
    // El rango de fechas es el del horario, no el de cuando se pidio la cita:
    // el calendario pregunta por dias, no por fechas de registro.
    ...(filtros.desde || filtros.hasta
      ? {
          availability: {
            is: {
              date: {
                ...(filtros.desde ? { gte: parseDateOnly(filtros.desde) } : {}),
                ...(filtros.hasta ? { lte: parseDateOnly(filtros.hasta) } : {}),
              },
            },
          },
        }
      : {}),
  };
}

export async function list(user, businessId, filtros = {}) {
  const { limit: tomar, offset: saltar } = pagination(filtros);
  const where = whereDe(user, businessId, filtros);

  const [items, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: tomar,
      skip: saltar,
    }),
    prisma.appointment.count({ where }),
  ]);

  return { items: items.map((cita) => citaView(cita)), total };
}

export async function getById(user, businessId, id) {
  const cita = await prisma.appointment.findFirst({
    where: { id, businessId },
    include: { ...INCLUDE, events: HISTORIAL },
  });

  if (!cita) {
    throw ApiError.notFound('Cita no encontrada');
  }

  // Un cliente no recibe confirmacion de que la cita ajena existe: 404, no 403.
  if (user.role === 'CLIENT' && cita.clientId !== user.clientId) {
    throw ApiError.notFound('Cita no encontrada');
  }

  return cita;
}

export async function detail(user, businessId, id) {
  return citaView(await getById(user, businessId, id));
}

/** Cifras del panel: cuantas citas hay en cada estado y cuantas son de hoy. */
export async function resumen(user, businessId) {
  const base = { businessId, ...(user.role === 'CLIENT' ? { clientId: user.clientId } : {}) };
  const hoy = hoyLocal();

  const [porEstado, hoyTotal] = await Promise.all([
    prisma.appointment.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.appointment.count({
      where: {
        ...base,
        status: { in: [...OCUPAN, 'COMPLETED'] },
        availability: { is: { date: parseDateOnly(hoy) } },
      },
    }),
  ]);

  const cuenta = Object.fromEntries(porEstado.map((fila) => [fila.status, fila._count._all]));

  return {
    resumen: {
      pendientes: cuenta.PENDING ?? 0,
      coordinadas: cuenta.COORDINATED ?? 0,
      completadas: cuenta.COMPLETED ?? 0,
      canceladas: cuenta.CANCELLED ?? 0,
      rechazadas: cuenta.REJECTED ?? 0,
      hoy: hoyTotal,
    },
  };
}

/**
 * Reserva un horario y deja la cita lista. La tarea que hay detras (el servicio
 * que se quiere) se crea aqui: es lo que despues aparece como "de cita" en la
 * lista de tareas y lo que el frontend muestra como titulo.
 *
 * Todo va en una transaccion: o queda la cita con su tarea, su primer evento y
 * su notificacion y el horario reservado, o no queda nada.
 */
export async function create(user, businessId, { availabilityId, clientId, categoryId, title, note, status }) {
  // El CLIENT reserva siempre para si mismo, ignorando cualquier clientId.
  const pedidoPor = user.role === 'CLIENT' ? user.clientId : clientId;

  if (!pedidoPor) {
    throw ApiError.badRequest('Elige el cliente de la cita');
  }

  const nueva = await prisma.$transaction(async (tx) => {
    const [hueco, cliente] = await Promise.all([
      tx.availability.findFirst({ where: { id: availabilityId, businessId } }),
      tx.client.findFirst({ where: { id: pedidoPor, businessId }, select: { id: true, userId: true } }),
    ]);

    if (!hueco) {
      throw ApiError.notFound('Horario no encontrado');
    }

    if (!cliente) {
      throw ApiError.badRequest('El cliente indicado no pertenece al negocio');
    }

    if (categoryId) {
      const categoria = await tx.category.findFirst({ where: { id: categoryId, businessId }, select: { id: true, name: true } });

      if (!categoria) {
        throw ApiError.badRequest('La categoria indicada no pertenece al negocio');
      }
    }

    await assertHuecoLibre(tx, hueco);

    const servicio = await tx.task.create({
      data: {
        businessId,
        title: title || 'Cita',
        categoryId,
        clientId: cliente.id,
        // La tarea hereda fecha y hora del horario, que es donde se realiza.
        dueDate: hueco.date,
        dueTime: hueco.startTime,
      },
      select: { id: true, title: true },
    });

    const cita = await tx.appointment.create({
      data: {
        businessId,
        taskId: servicio.id,
        clientId: cliente.id,
        availabilityId,
        note,
        status,
      },
      include: INCLUDE,
    });

    await tx.availability.update({ where: { id: availabilityId }, data: { status: 'RESERVED' } });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: cita.id,
        actorId: user.id,
        toStatus: status,
        note: status === 'COORDINATED' ? 'Cita registrada y confirmada' : 'Cita reservada',
      },
    });

    await notificar(tx, {
      userId: cliente.userId,
      appointmentId: cita.id,
      type: 'APPOINTMENT_CREATED',
      title: 'Cita reservada',
      message: `Tu cita para "${servicio.title}" quedo reservada (${formatDateOnly(hueco.date)} ${hueco.startTime}-${hueco.endTime}).`,
    });

    return releer(tx, cita.id);
  });

  // Si la administracion la registro ya coordinada, el cliente se tiene que
  // enterar por correo igual que si se hubiera confirmado despues.
  if (status === 'COORDINATED') {
    void avisarCitaCoordinada(nueva);
  }

  return nueva;
}

/**
 * Anotacion y reprogramacion. Mover de horario suelta el viejo y reserva el
 * nuevo; el servicio que hay detras se mueve con la cita para que no se
 * desincronice.
 */
export async function update(user, businessId, id, { availabilityId, note }) {
  const actual = await getById(user, businessId, id);

  if (!OCUPAN.includes(actual.status)) {
    throw ApiError.conflict('Una cita cerrada no se puede mover');
  }

  return prisma.$transaction(async (tx) => {
    let huecoNuevo = null;

    if (availabilityId !== undefined && availabilityId !== actual.availabilityId) {
      huecoNuevo = await tx.availability.findFirst({ where: { id: availabilityId, businessId } });

      if (!huecoNuevo) {
        throw ApiError.notFound('Horario no encontrado');
      }

      await assertHuecoLibre(tx, huecoNuevo);
    }

    await tx.appointment.update({
      where: { id },
      data: {
        ...(note !== undefined ? { note } : {}),
        ...(huecoNuevo ? { availabilityId } : {}),
      },
    });

    if (huecoNuevo) {
      await tx.appointmentEvent.create({
        data: {
          appointmentId: id,
          actorId: user.id,
          fromStatus: actual.status,
          toStatus: actual.status,
          note: `Reprogramada a ${formatDateOnly(huecoNuevo.date)} ${huecoNuevo.startTime}`,
        },
      });

      await liberarHuecos(tx, [{ availabilityId: actual.availabilityId, status: actual.status }]);

      await tx.availability.update({ where: { id: huecoNuevo.id }, data: { status: 'RESERVED' } });

      await tx.task.update({
        where: { id: actual.taskId },
        data: { dueDate: huecoNuevo.date, dueTime: huecoNuevo.startTime },
      });
    }

    return releer(tx, id);
  });
}

/**
 * Una de las acciones del modal de detalle: coordinar, completar, rechazar,
 * cancelar. El estado de destino no lo elige el que llama, lo decide la ruta.
 */
export async function actuar(user, businessId, id, accion, { note } = {}) {
  const status = ESTADO_POR_ACCION[accion];

  const actual = await getById(user, businessId, id);

  // El cliente solo puede tocar su propia cita: sobre una ajena se responde 404,
  // no 403, para no confirmar que existe. Que pueda o no ejecutar la accion lo
  // decide el router.
  if (user.role === 'CLIENT' && actual.clientId !== user.clientId) {
    throw ApiError.notFound('Cita no encontrada');
  }

  const permitidos = TRANSITIONS[actual.status];

  if (!permitidos.includes(status)) {
    throw ApiError.conflict(
      `Esta cita ya no se puede pasar a ${status}. Estado actual: ${actual.status}.`
    );
  }

  const cita = await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id }, data: { status } });

    await tx.appointmentEvent.create({
      data: { appointmentId: id, actorId: user.id, fromStatus: actual.status, toStatus: status, note },
    });

    // La tarea que hay detras se cierra con la cita: una cita completada deja
    // un trabajo completado, no uno pendiente colgando.
    const estadoTarea = TAREA_AL_CERRAR[status];

    if (estadoTarea) {
      await tx.task.update({ where: { id: actual.taskId }, data: { status: estadoTarea } });
    }

    // Cancelar o rechazar sueltan el bloque. Completar no: el horario se quedo
    // consumido por la cita que se realizo.
    if (LIBERAN_HUECO.includes(status) && OCUPAN.includes(actual.status)) {
      await liberarHuecos(tx, [{ availabilityId: actual.availabilityId, status: actual.status }]);
    }

    await notificar(tx, {
      userId: actual.client.user.id,
      appointmentId: id,
      type: `APPOINTMENT_${status}`,
      title: `Cita ${ETIQUETAS[status]}`,
      message: `Tu cita "${actual.task.title}" paso a ${ETIQUETAS[status]}.`,
    });

    return releer(tx, id);
  });

  // El correo sale despues del commit y sin esperar a nadie: la coordinacion ya
  // esta guardada, y que Resend este lento o caido no devuelve un error al que
  // coordino ni deja la cita a medias.
  if (status === 'COORDINATED') {
    void avisarCitaCoordinada(cita);
  }

  return cita;
}

const ETIQUETAS = {
  PENDING: 'pendiente',
  COORDINATED: 'coordinada',
  COMPLETED: 'completada',
  CANCELLED: 'cancelada',
  REJECTED: 'rechazada',
};

/**
 * Borrar una cita. El horario queda libre y la tarea que colgaba de ella se va
 * con ella: si se dejara, apareceria como una tarea suelta que nadie ha creado.
 */
export async function remove(user, businessId, id) {
  const cita = await getById(user, businessId, id);

  if (user.role === 'CLIENT') {
    throw ApiError.forbidden('No tienes permisos para esta accion');
  }

  return prisma.$transaction(async (tx) => {
    await tx.appointment.delete({ where: { id } });

    await liberarHuecos(tx, [{ availabilityId: cita.availabilityId, status: cita.status }]);

    const quedan = await tx.appointment.count({ where: { taskId: cita.taskId } });

    if (quedan === 0) {
      await tx.task.delete({ where: { id: cita.taskId } });
    }
  });
}

/**
 * Devuelve a AVAILABLE los horarios que ya no tienen ninguna cita que los retenga.
 *
 * Recibe la transaccion del que llama, para que la liberacion y el borrado sean
 * la misma operacion, y tambien las citas que se van a borrar. Necesita saber
 * cuales son porque van por delante del `groupBy`: cuando una cita completada ya
 * esta borrada no hay forma de preguntar por ella, asi que su bloque se soltaria
 * por el simple hecho de no encontrar nada encima. Pasandolas de entrada, el
 * borrado respeta la misma regla que la transicion a COMPLETED.
 *
 * Es lo que usan tambien las bajas en cascada: borrar un cliente o una tarea se
 * lleva sus citas por delante.
 */
export async function liberarHuecos(tx, citas) {
  const retenidas = citas.filter((cita) => cita.status === 'COMPLETED');

  const ids = [...new Set(citas.map((cita) => cita.availabilityId))].filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  // Los bloques de las citas completadas salen antes de mirar la base: su cita
  // va a desaparecer y, si se preguntara despues, no habria nada que la
  // delatara como consumida.
  const candidatos = ids.filter((id) => !retenidas.some((cita) => cita.availabilityId === id));

  if (candidatos.length === 0) {
    return;
  }

  const ocupadas = await tx.appointment.groupBy({
    by: ['availabilityId'],
    where: { availabilityId: { in: candidatos }, status: { in: RETIENEN_HUECO } },
  });

  const libres = candidatos.filter((id) => !ocupadas.some((fila) => fila.availabilityId === id));

  if (libres.length > 0) {
    await tx.availability.updateMany({ where: { id: { in: libres } }, data: { status: 'AVAILABLE' } });
  }
}

/** El horario tiene que estar libre y sin citas vivas: se comprueban las dos. */
async function assertHuecoLibre(tx, hueco) {
  if (hueco.status !== 'AVAILABLE') {
    throw ApiError.conflict('Ese horario ya no esta disponible');
  }

  const activas = await tx.appointment.count({
    where: { availabilityId: hueco.id, status: { in: OCUPAN } },
  });

  if (activas > 0) {
    throw ApiError.conflict('Ese horario ya tiene una cita activa');
  }
}

async function notificar(tx, { userId, appointmentId, type, title, message }) {
  await tx.notification.create({
    data: { userId, appointmentId, type, title, message, channel: 'INTERNAL' },
  });
}