import { prisma } from '../../../../config/driver.js';
import { logger } from '../../../../config/logger.js';
import { ApiError } from '../../../utils/ApiError.js';
import { formatDateOnly, hoyEn, parseDateOnly, instanteEn } from '../../../utils/dates.js';
import { pagination } from '../../../utils/pagination.js';
import { auditar } from '../../../utils/audit.js';
import { avisarCitaCoordinada, avisarCitaCancelada } from '../../notification/service/email.service.js';
import { avisarListaEspera } from '../../notification/service/waitlist-email.service.js';
import { candidatosParaHueco, marcarNotificado } from '../../staff/service/waitlist.service.js';
import { ESTADO_POR_ACCION, OCUPAN, TRANSITIONS } from '../appointment.validation.js';

const INCLUDE = {
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      category: { select: { id: true, name: true, color: true, durationMin: true } },
    },
  },
  client: {
    select: { id: true, nombre: true, telefono: true, user: { select: { id: true, email: true } } },
  },
  availability: { select: { id: true, date: true, startTime: true, endTime: true, status: true } },
  staff: { select: { id: true, nombre: true, color: true } },
  business: { select: { id: true, nombre: true } },
  _count: { select: { reminders: true } },
};

const HISTORIAL = {
  orderBy: { createdAt: 'asc' },
  include: { actor: { select: { id: true, nombre: true, role: true } } },
};

/** Estado de la tarea que hay detras de la cita cuando la cita se cierra. */
const TAREA_AL_CERRAR = {
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'CANCELLED',
  NO_SHOW: 'CANCELLED',
};

/**
 * Dispara una promesa sin esperarla y SIN que pueda tumbar el proceso.
 *
 * Los avisos de correo y de lista de espera salen despues del commit: la
 * coordinacion ya esta guardada y que Resend este lento no debe devolver un error
 * a quien coordino ni dejar la cita a medias.
 *
 * Un `void fn()` a secas no cumple esa promesa: si `fn` llega a rechazar, Node
 * lanza `unhandledRejection` y el proceso muere. Este envoltorio engancha el
 * `catch` SIEMPRE, tambien cuando la funcion lanza de forma sincrona antes de
 * devolver su promesa.
 */
function enSegundoPlano(nombre, fn) {
  try {
    Promise.resolve(fn()).catch((error) => {
      logger.warn(`fallo en segundo plano: ${nombre}`, { error: error?.message ?? String(error) });
    });
  } catch (error) {
    logger.warn(`fallo en segundo plano: ${nombre}`, { error: error?.message ?? String(error) });
  }
}

/**
 * Estados que devuelven el bloque a la bolsa al cerrarse la cita.
 *
 * COMPLETED y NO_SHOW **no** estan aqui, y esa es toda la diferencia con lo que
 * hacia antes: una cita completada se realizo, ese rato se consumio, y devolver el
 * bloque a AVAILABLE lo ponia otra vez a la venta para el mismo dia y hora. Ahora
 * queda en RESERVED: el cliente ya no lo ve (el filtro de agenda solo muestra
 * AVAILABLE) y una reserva nueva encima da 409.
 *
 * NO_SHOW se comporta igual que COMPLETED por el mismo motivo: el profesional
 * estuvo disponible y el cliente no vino. El rato se perdio.
 *
 * CANCELLED y REJECTED si lo sueltan: la cita no llego a celebrarse.
 */
const LIBERAN_HUECO = ['CANCELLED', 'REJECTED'];

/**
 * Estados que impiden devolver un bloque a AVAILABLE mientras exista la cita que lo
 * consume. Es OCUPAN mas COMPLETED y NO_SHOW.
 */
const RETIENEN_HUECO = [...OCUPAN, 'COMPLETED', 'NO_SHOW'];

/**
 * Como la pinta el frontend. La cita se lee siempre a traves de su tarea (el
 * servicio), su cliente, su profesional y su horario, y el historial se trae ya
 * montado para que el detalle no necesite una segunda peticion.
 */
function citaView({ client, availability, staff, events, _count, ...cita }) {
  return {
    ...cita,
    client: {
      id: client.id,
      nombre: client.nombre,
      telefono: client.telefono,
      email: client.user?.email ?? null,
    },
    availability: { ...availability, date: formatDateOnly(availability.date) },
    profesional: staff,
    recordatorios: _count.reminders,
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
 * apuntar el evento) y lo que devuelve la llamada inicial es el estado de antes de
 * ellas: responder con eso seria ensenarle al frontend un horario libre que acaba
 * de ocuparse.
 */
async function releer(tx, id) {
  const cita = await tx.appointment.findUnique({
    where: { id },
    include: { ...INCLUDE, events: HISTORIAL },
  });

  return citaView(cita);
}

/**
 * Filtro de la lista. El texto busca por cliente y por servicio a la vez, que es
 * lo que promete el buscador ("buscar por cliente o servicio").
 */
function whereDe(user, businessId, filtros = {}) {
  const texto = String(filtros.q || '').trim();

  return {
    businessId,
    deletedAt: null,
    /// El cliente nunca filtra por otro clientId: solo ve los suyos.
    ...(user.role === 'CLIENT' ? { clientId: user.clientId } : {}),
    ...(user.role !== 'CLIENT' && filtros.clientId ? { clientId: filtros.clientId } : {}),
    ...(filtros.staffId ? { staffId: filtros.staffId } : {}),
    ...(filtros.categoryId ? { task: { categoryId: filtros.categoryId } } : {}),
    ...(filtros.estado ? { status: filtros.estado } : {}),
    ...(texto
      ? {
          OR: [{ client: { nombre: { contains: texto } } }, { task: { title: { contains: texto } } }],
        }
      : {}),
    /// El rango de fechas es el del horario, no el de cuando se pidio la cita:
    /// el calendario pregunta por dias, no por fechas de registro.
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

  return { items: items.map(citaView), total };
}

export async function getById(user, businessId, id) {
  const cita = await prisma.appointment.findFirst({
    where: { id, businessId, deletedAt: null },
    include: { ...INCLUDE, events: HISTORIAL },
  });

  if (!cita) throw ApiError.notFound('Cita no encontrada');

  /// Un cliente no recibe confirmacion de que la cita ajena existe: 404, no 403.
  if (user.role === 'CLIENT' && cita.clientId !== user.clientId) {
    throw ApiError.notFound('Cita no encontrada');
  }

  return cita;
}

export async function detail(user, businessId, id) {
  return citaView(await getById(user, businessId, id));
}

/** Cifras del panel: cuantas citas hay en cada estado y cuantas son de hoy. */
export async function resumen(user, businessId, timezone = 'UTC') {
  const base = {
    businessId,
    deletedAt: null,
    ...(user.role === 'CLIENT' ? { clientId: user.clientId } : {}),
  };
  const hoy = hoyEn(timezone);

  const [porEstado, hoyTotal, proximas] = await Promise.all([
    prisma.appointment.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.appointment.count({
      where: {
        ...base,
        status: { in: [...OCUPAN, 'COMPLETED'] },
        availability: { is: { date: parseDateOnly(hoy) } },
      },
    }),
    /// v2: las proximas citas del cliente. Sin esto, el panel del cliente
    /// abria con un contador y nada mas: el usuario tenia que entrar a "mis citas"
    /// a ver cual era la siguiente.
    prisma.appointment.findMany({
      where: {
        ...base,
        status: { in: OCUPAN },
        availability: { is: { date: { gte: parseDateOnly(hoy) } } },
      },
      include: INCLUDE,
      orderBy: { availability: { date: 'asc' } },
      take: 3,
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
      ausencias: cuenta.NO_SHOW ?? 0,
      hoy: hoyTotal,
    },
    proximas: proximas.map(citaView),
  };
}

/**
 * Reserva un horario y deja la cita lista. La tarea que hay detras (el servicio que
 * se quiere) se crea aqui: es lo que despues aparece como "de cita" en la lista de
 * tareas y lo que el frontend muestra como titulo.
 *
 * Todo va en una transaccion: o queda la cita con su tarea, su primer evento y su
 * notificacion y el horario reservado, o no queda nada.
 *
 * ------------------------------------------------------------------------
 * EL DOBLE BOOKING
 *
 * v1 comprobaba que el hueco estuviera libre ANTES de escribir, dentro de la misma
 * transaccion pero sin ninguna garantia. Bajo el aislamiento por defecto de
 * PostgreSQL (READ COMMITTED), dos peticiones simultaneas sobre el mismo hueco
 * leen ambas "AVAILABLE", ambas cuentan cero citas activas, y las dos escriben:
 * dos clientes con cita para la misma hora y el mismo profesional.
 *
 * v2 lo resuelve en la BASE, no en la aplicacion: el indice unico parcial
 * `Appointment_hueco_vivo_key` cubre (availabilityId) solo para los estados vivos
 * (PENDING, COORDINATED). La segunda transaccion recibe 23505 y el errorHandler
 * lo traduce a un 409 legible. Por eso el service puede seguir comprobando (para
 * dar un mensaje claro antes de llegar al indice) sin que eso sea lo que upholda la
 * integridad: el indice es quien la upholda.
 * ------------------------------------------------------------------------
 */
export async function create(
  user,
  businessId,
  { availabilityId, clientId, categoryId, staffId, title, note, status },
  req,
  { timezone = 'UTC' } = {}
) {
  /// El CLIENT reserva siempre para si mismo, ignorando cualquier clientId.
  const pedidoPor = user.role === 'CLIENT' ? user.clientId : clientId;

  if (!pedidoPor) throw ApiError.badRequest('Elige el cliente de la cita');

  const nueva = await prisma.$transaction(async (tx) => {
    const [hueco, cliente] = await Promise.all([
      tx.availability.findFirst({ where: { id: availabilityId, businessId, deletedAt: null } }),
      tx.client.findFirst({
        where: { id: pedidoPor, businessId, deletedAt: null },
        select: { id: true, userId: true },
      }),
    ]);

    if (!hueco) throw ApiError.notFound('Horario no encontrado');
    if (!cliente) throw ApiError.badRequest('El cliente indicado no pertenece al negocio');

    /**
     * No se puede reservar en el pasado.
     *
     * v1 no lo comprobaba: la API permitia crear una cita para ayer si se sabia el
     * id del hueco. El listado de disponibilidad oculta los pasados, pero eso no
     * protege a quien llama directamente.
     */
    assertFechaFutura(hueco, timezone);

    if (categoryId) {
      const categoria = await tx.category.findFirst({
        where: { id: categoryId, businessId, deletedAt: null },
        select: { id: true, name: true },
      });

      if (!categoria) throw ApiError.badRequest('La categoria indicada no pertenece al negocio');
    }

    if (staffId) {
      const profesional = await tx.staff.findFirst({
        where: { id: staffId, businessId, deletedAt: null, activo: true },
        select: { id: true },
      });

      if (!profesional) throw ApiError.badRequest('El profesional indicado no pertenece al negocio');
    }

    await assertHuecoLibre(tx, hueco, user.id);

    const servicio = await tx.task.create({
      data: {
        businessId,
        title: title || 'Cita',
        categoryId,
        clientId: cliente.id,
        /// La tarea hereda fecha y hora del horario, que es donde se realiza.
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
        staffId: staffId ?? hueco.staffId ?? null,
        note,
        status,
      },
      include: INCLUDE,
    });

    /// Se reserva el hueco y se SUELTA la retencion en el mismo sitio: el
    /// cliente que estaba con el formulario abierto pasa a tener la cita de
    /// verdad, y el hueco deja de estar retenido.
    await tx.availability.update({
      where: { id: availabilityId },
      data: { status: 'RESERVED', heldUntil: null, heldById: null },
    });

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

  auditar({
    businessId,
    actorId: user.id,
    action: 'create',
    entity: 'Appointment',
    entityId: nueva.id,
    req,
  });

  /// Si la administracion la registro ya coordinada, el cliente se tiene que
  /// enterar por correo igual que si se hubiera confirmado despues.
  if (status === 'COORDINATED') {
    void avisarCitaCoordinada(nueva, { timezone });
  }

  return nueva;
}

/** El hueco tiene que estar en el futuro, en la zona del negocio. */
function assertFechaFutura(hueco, timezone) {
  const hoy = hoyEn(timezone);

  if (formatDateOnly(hueco.date) < hoy) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'availabilityId', message: 'Ese horario ya paso' },
    ]);
  }
}

/**
 * Anotacion y reprogramacion. Mover de horario suelta el viejo y reserva el
 * nuevo; el servicio que hay detras se mueve con la cita para que no se
 * desincronice.
 *
 * El hueco viejo se libera DESPUES de escribir la cita nueva: mientras la cita
 * siga apuntando al viejo, ese bloque sigue ocupado de verdad, y liberarlo antes
 * lo pondria a la venta con una cita encima.
 */
export async function update(
  user,
  businessId,
  id,
  { availabilityId, staffId, note, version },
  req,
  { timezone = 'UTC' } = {}
) {
  const actual = await getById(user, businessId, id);

  if (!OCUPAN.includes(actual.status)) {
    throw ApiError.conflict('Una cita cerrada no se puede mover');
  }

  /**
   * Version optimista.
   *
   * Dos administradores editando la misma cita a la vez (unoCoordina mientras
   * el otro reprograma) se pisan en silencio: el ultimo en escribir gana y el
   * primero no se entera de que su cambio se perdio. Con la version, el que
   * escribe sobre una version vieja recibe 409 en vez de pisar al otro.
   */
  if (version !== undefined && version !== null && version !== actual.version) {
    throw ApiError.conflict('Esta cita cambio mientras la estabas editando. Recargala e intentalo otra vez.');
  }

  return prisma.$transaction(async (tx) => {
    let huecoNuevo = null;

    if (availabilityId !== undefined && availabilityId !== actual.availabilityId) {
      huecoNuevo = await tx.availability.findFirst({
        where: { id: availabilityId, businessId, deletedAt: null },
      });

      if (!huecoNuevo) throw ApiError.notFound('Horario no encontrado');

      assertFechaFutura(huecoNuevo, timezone);

      await assertHuecoLibre(tx, huecoNuevo, user.id);
    }

    const actualizada = await tx.appointment.update({
      where: { id },
      data: {
        ...(note !== undefined ? { note } : {}),
        ...(huecoNuevo ? { availabilityId } : {}),
        ...(staffId !== undefined ? { staffId } : {}),
        version: { increment: 1 },
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

      /// Libera el viejo, reserva el nuevo y mueve la tarea para que no se
      /// desincronice.
      await liberarHuecos(tx, [{ availabilityId: actual.availabilityId, status: actual.status }]);

      await tx.availability.update({
        where: { id: huecoNuevo.id },
        data: { status: 'RESERVED', heldUntil: null, heldById: null },
      });

      await tx.task.update({
        where: { id: actual.taskId },
        data: { dueDate: huecoNuevo.date, dueTime: huecoNuevo.startTime },
      });
    }

    await reprogramarRecordatorios(tx, actualizada.id, huecoNuevo, timezone);

    return releer(tx, id);
  });
}

/**
 * Una de las acciones del modal de detalle: coordinar, completar, rechazar,
 * cancelar, no-show. El estado de destino no lo elige quien llama, lo decide la
 * ruta.
 */
export async function actuar(
  user,
  businessId,
  id,
  accion,
  { note, cancelReason, noShowReason } = {},
  req,
  { timezone = 'UTC' } = {}
) {
  const status = ESTADO_POR_ACCION[accion];

  const actual = await getById(user, businessId, id);

  /// El cliente solo puede tocar su propia cita: sobre una ajena se responde 404,
  /// no 403, para no confirmar que existe. Que pueda o no ejecutar la accion lo
  /// decide el router.
  if (user.role === 'CLIENT' && actual.clientId !== user.clientId) {
    throw ApiError.notFound('Cita no encontrada');
  }

  const permitidos = TRANSITIONS[actual.status];

  /// `TRANSITIONS` solo tiene los estados conocidos. Un estado que llegara de otra
  /// fuente (una fila vieja, una escritura directa, un estado nuevo anadido a
  /// `STATUSES` sin tocar el mapa) deja `permitidos` en `undefined` y
  /// `permitidos.includes(...)` revienta con un TypeError que sale como 500.
  /// Aqui se responde 409, que es lo que de verdad es: la cita esta en un estado
  /// en el que no se puede actuar.
  if (!permitidos?.includes(status)) {
    throw ApiError.conflict(`Esta cita ya no se puede pasar a ${status}. Estado actual: ${actual.status}.`);
  }

  /// Cancelar y rechazar exigen motivo. Sin el, "por que se cancelan las citas" es
  /// una pregunta sin respuesta, porque la nota libre se escribe de todo tipo de
  /// cosas y nunca se llena.
  ///
  /// NO_SHOW comprueba SU campo: antes aceptaba `cancelReason` como sustituto y
  /// luego guardaba "Sin especificar", de modo que el motivo de una ausencia
  /// acababa siempre en el mismo texto y la metrica que sale de esta columna
  /// (schema.prisma:413) no decia nada.
  const motivo = status === 'NO_SHOW' ? noShowReason : cancelReason;

  if (['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(status) && !motivo) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: status === 'NO_SHOW' ? 'noShowReason' : 'cancelReason', message: 'Indica el motivo' },
    ]);
  }

  const cita = await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id },
      data: {
        status,
        version: { increment: 1 },
        ...(['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(status)
          ? { cancelReason: motivo ?? 'Sin especificar' }
          : {}),
        /// El check-in se congela al completar: se guarda el valor que hay, que ya
        /// es la hora real de llegada. Escribirlo a proposito evita que un
        /// completar sin pasar por checkin invente una hora de llegada.
        ...(status === 'COMPLETED' ? { checkedInAt: actual.checkedInAt } : {}),
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: id,
        actorId: user.id,
        fromStatus: actual.status,
        toStatus: status,
        note: note ?? cancelReason ?? noShowReason ?? null,
      },
    });

    /// La tarea que hay detras se cierra con la cita: una cita completada deja un
    /// trabajo completado, no uno pendiente colgando.
    const estadoTarea = TAREA_AL_CERRAR[status];

    if (estadoTarea) {
      await tx.task.update({ where: { id: actual.taskId }, data: { status: estadoTarea } });
    }

    /// Cancelar o rechazar sueltan el bloque. Completar y no-show no: el horario se
    /// quedo consumido por la cita que se realizo.
    if (LIBERAN_HUECO.includes(status) && OCUPAN.includes(actual.status)) {
      await liberarHuecos(tx, [{ availabilityId: actual.availabilityId, status: actual.status }]);
    }

    if (!OCUPAN.includes(status)) {
      await cancelarRecordatorios(tx, id);
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

  auditar({ businessId, actorId: user.id, action: accion, entity: 'Appointment', entityId: id, req });

  /// El correo sale despues del commit y sin esperar a nadie: la coordinacion ya
  /// esta guardada, y que Resend este lento o caido no devuelve un error al que
  /// coordino ni deja la cita a medias.
  if (status === 'COORDINATED') {
    enSegundoPlano('aviso de cita coordinada', () => avisarCitaCoordinada(cita, { timezone }));
  }

  if (['CANCELLED', 'REJECTED'].includes(status)) {
    enSegundoPlano('aviso de cita cancelada', () => avisarCitaCancelada(cita, { timezone }));

    /// Al soltarse el hueco, quien estaba en lista de espera para ese dia tiene
    /// un interes directo en saberlo. Se avisa FUERA de la transaccion: el aviso no
    /// es parte del cambio de estado y no debe poder tumbarlo.
    if (LIBERAN_HUECO.includes(status)) {
      enSegundoPlano('aviso a lista de espera', () =>
        avisarEsperaPorHueco(businessId, actual.availabilityId, timezone)
      );
    }
  }

  return cita;
}

const ETIQUETAS = {
  PENDING: 'pendiente',
  COORDINATED: 'coordinada',
  COMPLETED: 'completada',
  CANCELLED: 'cancelada',
  REJECTED: 'rechazada',
  NO_SHOW: 'no asistio',
};

/**
 * Check-in en la sala de espera (nuevo en v2).
 *
 * No cambia el estado: es una marca de tiempo. Sirve para medir el tiempo de
 * espera real y para que quien atiende sepa quien ya llego. Un 404 en vez de
 * "todavia no" en el cliente, que es lo que haria un endpoint de consulta
 * aparte para marcar un campo.
 */
export async function checkin(user, businessId, id, req) {
  const actual = await getById(user, businessId, id);

  if (!OCUPAN.includes(actual.status)) {
    throw ApiError.conflict('Solo se puede registrar la llegada de una cita que sigue viva');
  }

  const cita = await prisma.appointment.update({
    where: { id },
    data: { checkedInAt: new Date() },
    include: { ...INCLUDE, events: HISTORIAL },
  });

  auditar({ businessId, actorId: user.id, action: 'checkin', entity: 'Appointment', entityId: id, req });

  return citaView(cita);
}

/**
 * Borrar una cita: LOGICA por defecto (soft delete).
 *
 * v1 hacia un DELETE en cascada que se llevaba por delante la tarea de servicio, el
 * historial de estados y las notificaciones. Un "se ha borrado sin querer" no
 * tenia vuelta atras, y el hueco quedaba en un estado que solo se arreglaba
 * desde la consola.
 *
 * Ahora la cita se marca `deletedAt` y su tarea tambien (si no le quedaban mas
 * citas). El historial se conserva, que es lo que de verdad importa en un negocio
 * que lleva las cuentas.
 *
 * Con `?hard=true` se borra de verdad, y va aparte del PATCH a proposito: es
 * irreversible.
 */
export async function remove(user, businessId, id, req, { hard = false } = {}) {
  const cita = await getById(user, businessId, id);

  if (user.role === 'CLIENT') {
    throw ApiError.forbidden('No tienes permisos para esta accion');
  }

  await prisma.$transaction(async (tx) => {
    if (hard) {
      await tx.appointment.delete({ where: { id } });
    } else {
      await tx.appointment.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'CANCELLED', cancelReason: 'Cita eliminada' },
      });
    }

    /*
     * Los recordatorios pendientes se cancelan AQUI y no solo en `actuar`.
     *
     * Sin esto, borrar una cita dejaba sus avisos en PENDING y el worker mandaba
     * "te recordamos tu cita" de algo que ya no existe. El filtro del worker ya
     * no deja pasar citas borradas, pero dejar filas huerfanas en la cola era una
     * bomba de reloj: en cuanto ese filtro se relajara, volvian a salir.
     */
    await cancelarRecordatorios(tx, id);

    await liberarHuecos(tx, [{ availabilityId: cita.availabilityId, status: cita.status }]);

    const quedan = await tx.appointment.count({
      where: { taskId: cita.taskId, deletedAt: null },
    });

    if (quedan === 0) {
      await tx.task.update({ where: { id: cita.taskId }, data: { deletedAt: new Date() } });
    }
  });

  auditar({
    businessId,
    actorId: user.id,
    action: hard ? 'delete_hard' : 'delete',
    entity: 'Appointment',
    entityId: id,
    req,
  });
}

/**
 * Devuelve a AVAILABLE los horarios que ya no tienen ninguna cita que los retenga.
 *
 * Recibe la transaccion del que llama, para que la liberacion y el borrado sean la
 * misma operacion, y tambien las citas que se van a borrar. Necesita saber cuales
 * son porque van por delante del `groupBy`: cuando una cita completada ya esta
 * borrada no hay forma de preguntar por ella, asi que su bloque se soltaria por el
 * simple hecho de no encontrar nada encima. Pasandolas de entrada, el borrado
 * respeta la misma regla que la transicion a COMPLETED.
 *
 * Es lo que usan tambien las bajas en cascada: borrar un cliente o una tarea se
 * lleva sus citas por delante.
 */
export async function liberarHuecos(tx, citas) {
  const retenidas = citas.filter((cita) => cita.status === 'COMPLETED' || cita.status === 'NO_SHOW');

  const ids = [...new Set(citas.map((cita) => cita.availabilityId))].filter(Boolean);

  if (ids.length === 0) return;

  /// Los bloques de las citas completadas salen antes de mirar la base: su cita va
  /// a desaparecer y, si se preguntara despues, no habria nada que la delatara
  /// como consumida.
  const candidatos = ids.filter((id) => !retenidas.some((cita) => cita.availabilityId === id));

  if (candidatos.length === 0) return;

  const ocupadas = await tx.appointment.groupBy({
    by: ['availabilityId'],
    where: {
      availabilityId: { in: candidatos },
      status: { in: RETIENEN_HUECO },
      deletedAt: null,
    },
  });

  const libres = candidatos.filter((id) => !ocupadas.some((fila) => fila.availabilityId === id));

  if (libres.length > 0) {
    await tx.availability.updateMany({
      where: { id: { in: libres } },
      data: { status: 'AVAILABLE', heldUntil: null, heldById: null },
    });
  }
}

/**
 * El horario tiene que estar libre y sin citas vivas: se comprueban las dos.
 *
 * Se acepta tambien `HELD`, pero SOLO si la retencion es del propio usuario que
 * esta reservando. Es el caso normal: el cliente retiene el hueco, tarda dos minutos
 * en escribir la nota y al confirmar se encuentra con su propia retencion. Si se
 * rechazara cualquier `HELD`, la retencion bloquearia la reserva que justamente
 * pretendia facilitar.
 *
 * Y al reves: si se aceptara el `HELD` de cualquiera, dos clientes acabarian
 * reservando el mismo bloque, que es justo lo que la retencion evita.
 *
 * Esta comprobacion da un mensaje claro ANTES de llegar al indice unico, que es lo
 * que ve el usuario normal. El indice sigue siendo quien garantiza la integridad
 * bajo concurrencia: esto es la UX, no la garantia.
 */
async function assertHuecoLibre(tx, hueco, userId) {
  const retenidoPorMi =
    hueco.status === 'HELD' &&
    hueco.heldUntil !== null &&
    hueco.heldUntil > new Date() &&
    hueco.heldById === userId;

  if (hueco.status !== 'AVAILABLE' && !retenidoPorMi) {
    throw ApiError.conflict('Ese horario ya no esta disponible');
  }

  const activas = await tx.appointment.count({
    where: { availabilityId: hueco.id, status: { in: OCUPAN }, deletedAt: null },
  });

  if (activas > 0) {
    throw ApiError.conflict('Ese horario ya tiene una cita activa');
  }
}

/**
 * Avisa a quien estaba en lista de espera por un hueco que se acaba de liberar.
 *
 * Ahi esta la diferencia entre "cancelar" y "cancelar y reponer la agenda": sin
 * esto, el hueco vuelve a estar disponible pero nadie se entera hasta que mire el
 * calendario otra vez.
 */
/*
 * `timezone` no se usa y el nombre lo deja claro a proposito.
 *
 * El aviso a la lista de espera lleva la fecha del hueco, que es una FECHA DE
 * CALENDARIO, y las horas como texto. Aplicarle la zona del negocio aqui seria un
 * error: en Montevideo (UTC-3), un hueco del lunes a las 09:00 imprimiria "domingo"
 * por el desplazamiento a medianoche. El parametro se conserva para que quien
 * llame desde `actuar` lea la misma firma en las tres funciones de aviso.
 */
async function avisarEsperaPorHueco(businessId, availabilityId, _timezone) {
  try {
    const hueco = await prisma.availability.findFirst({
      where: { id: availabilityId },
      select: { id: true, businessId: true, date: true, startTime: true, endTime: true, staffId: true },
    });

    if (!hueco) return;

    const candidatos = await candidatosParaHueco(businessId, hueco);

    for (const entrada of candidatos) {
      const resultado = await avisarListaEspera(entrada, hueco);

      /// Solo se marca como notificado si el aviso se mando de verdad. Marcar antes
      /// dejaria a alguien marcado como avisado que no lo fue, y no volveria a
      /// intentarse nunca.
      if (resultado.enviado) {
        await marcarNotificado(entrada.id);
      }
    }
  } catch (error) {
    /// El aviso a la lista de espera NUNCA puede tumbar la cancelacion: la cita ya
    /// esta cancelada y el hueco liberado, que es lo importante.
    ///
    /// Se usa el logger del modulo y NO `req?.log`: `req` no existe en este scope
    /// (la funcion no lo recibe) y el encadenado opcional no salva de un
    /// ReferenceError. Ademas el logger no puede lanzar, asi que este catch es
    /// realmente el final de la cadena.
    logger.warn('fallo avisando a la lista de espera', { availabilityId, error: error.message });
  }
}

async function reprogramarRecordatorios(tx, appointmentId, huecoNuevo, timezone) {
  if (!huecoNuevo) return;

  await tx.reminder.updateMany({
    where: { appointmentId, status: 'PENDING' },
    data: { scheduledFor: instanteEn(formatDateOnly(huecoNuevo.date), huecoNuevo.startTime, timezone) },
  });
}

async function cancelarRecordatorios(tx, appointmentId) {
  await tx.reminder.updateMany({
    where: { appointmentId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
}

async function notificar(tx, { userId, appointmentId, type, title, message }) {
  await tx.notification.create({
    data: { userId, appointmentId, type, title, message, channel: 'INTERNAL' },
  });
}

export default {
  list,
  detail,
  resumen,
  create,
  update,
  remove,
  actuar,
  checkin,
  liberarHuecos,
};
