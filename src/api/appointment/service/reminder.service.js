import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { instanteEn, formatDateOnly, hoyEn, parseDateOnly } from '../../../utils/dates.js';
import { validateInt, validateOneOf, validateOrThrow } from '../../../utils/validation.js';
import { auditar } from '../../../utils/audit.js';
import { avisarRecordatorio } from '../../notification/service/email.service.js';

/**
 * Recordatorios de cita (nuevo en v2).
 *
 * En v1 el recordatorio era un enlace manual de WhatsApp que alguien tinha que
 * acordarse de pulsar. Aqui los recordatorios son filas de la base con su fecha de
 * envio, y el worker se encarga.
 *
 * Que sean filas y no un calculo "cada cita que viene en 24h tiene que avisarse"
 * es lo que permite: no duplicar avisos si el worker corre dos veces, ver que se
 * mando y que fallo, y que el negocio ajuste la anticipacion desde sus ajustes.
 */

export function createRules(body) {
  return validateOrThrow({
    channel: validateOneOf(body.channel ?? 'EMAIL', ['EMAIL', 'WHATSAPP'], 'channel'),
    /// Minutos antes de la cita. Null = usar el del negocio.
    minutesBefore: validateInt(body.minutesBefore, 'minutesBefore', { optional: true, min: 5, max: 43_200 }),
  });
}

/**
 * Recordatorios de una cita.
 *
 * El filtro va por la RELACION con la cita y no por `appointmentId` a secas. La
 * cita tiene que pertenecer al negocio que pide la lista: con `where: {
 * appointmentId }` el `businessId` que recibe la funcion se ignoraba, y bastaba
 * con recorrer ids de cita para leer los recordatorios (canal, estado de envio,
 * hora, errores) de OTRA empresa.
 */
export async function listFor(businessId, appointmentId) {
  return prisma.reminder.findMany({
    where: { appointment: { businessId, id: appointmentId, deletedAt: null } },
    orderBy: { scheduledFor: 'asc' },
    select: {
      id: true,
      channel: true,
      status: true,
      scheduledFor: true,
      sentAt: true,
      attempts: true,
      lastError: true,
    },
  });
}

/**
 * Programa un recordatorio.
 *
 * Si la fecha de envio cae en el pasado (porque la cita es en menos de X minutos),
 * se manda al instante en lugar deProgramming una hora que ya paso. Se avisa en la
 * respuesta con `inmediato: true` para que el frontend lo diga en vez de prometer
 * un aviso que no va a llegar.
 */
export async function create(businessId, appointmentId, { channel, minutesBefore }, req) {
  const cita = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId, deletedAt: null },
    include: {
      availability: { select: { date: true, startTime: true } },
      client: { select: { nombre: true, telefono: true, user: { select: { email: true } } } },
      task: { select: { title: true } },
      business: { select: { nombre: true } },
    },
  });

  if (!cita) throw ApiError.notFound('Cita no encontrada');

  const timezone = req.business?.timezone ?? 'UTC';
  const antes = minutesBefore ?? req.business?.settings?.reminderBeforeMin ?? 1440;

  const instanteCita = instanteEn(
    formatDateOnly(cita.availability.date),
    cita.availability.startTime,
    timezone
  );
  const scheduledFor = new Date(instanteCita.getTime() - antes * 60_000);

  const yaPasó = scheduledFor <= new Date();
  const enviable = scheduledFor <= new Date(instanteCita.getTime() - 5 * 60_000);

  if (!enviable) {
    throw ApiError.badRequest('Ese aviso llegaria despues de que empiece la cita');
  }

  const recordatorio = await prisma.reminder.create({
    data: {
      appointmentId,
      channel,
      status: yaPasó ? 'SENT' : 'PENDING',
      scheduledFor,
      sentAt: yaPasó ? new Date() : null,
      staffId: req.user?.id ?? null,
      createdById: req.user?.id ?? null,
    },
    select: { id: true, channel: true, status: true, scheduledFor: true, sentAt: true },
  });

  /// Si ya tocaba, se manda ahora y el worker no lohara dos veces.
  if (yaPasó) {
    const resultado = await avisarRecordatorio(cita, { channel, timezone });

    if (!resultado.enviado) {
      await prisma.reminder.update({
        where: { id: recordatorio.id },
        data: { status: 'FAILED', lastError: resultado.motivo, attempts: 1 },
      });
    }
  }

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'create',
    entity: 'Reminder',
    entityId: recordatorio.id,
    req,
  });

  return { recordatorio, inmediato: yaPasó };
}

/**
 * Envia los que tocan. La corre el worker.
 *
 * Devuelve cuantos se mandaron para que el log diga algo util. Un fallo individual
 * no para el lote: si un correo falla porque esa direccion no existe, los otros
 * veinte avisos de la tarde tienen que salir igual.
 */
export async function enviarPendientes({ limite = 100 } = {}) {
  /*
   * Se filtran las citas, no solo los recordatorios.
   *
   * El filtro de antes era `status: 'PENDING'` del RECORDATORIO y nada mas. Como
   * los caminos de cancelacion en masa (borrar una cita, borrar su cliente,
   * borrar su tarea) no tocaban los recordatorios, sus filas se quedaban en
   * PENDING y el worker mandaba "te recordamos tu cita" de algo que ya no
   * exista o que se habia cancelado.
   *
   * Aqui se exige que la cita siga viva: no borrada y en un estado que todavia
   * vaya a ocurrir. Un recordatorio huerfano no se envia: se queda para siempre
   * en la cola, pero nunca sale de ella, que es lo que se busca.
   */
  const pendientes = await prisma.reminder.findMany({
    where: {
      status: 'PENDING',
      scheduledFor: { lte: new Date() },
      appointment: {
        deletedAt: null,
        status: { in: ['PENDING', 'COORDINATED'] },
      },
    },
    include: {
      appointment: {
        include: {
          availability: { select: { date: true, startTime: true, endTime: true } },
          client: { select: { nombre: true, telefono: true, user: { select: { email: true } } } },
          task: { select: { title: true } },
          /// La zona del NEGOCIO, no la global: cada empresa redacta sus correos en
          /// su hora. Antes se usaba la de `timezone` que venia sin usar, y todos
          /// los correos salian en UTC.
          business: { select: { nombre: true, timezone: true } },
        },
      },
    },
    orderBy: { scheduledFor: 'asc' },
    take: limite,
  });

  let enviados = 0;
  let fallidos = 0;

  for (const recordatorio of pendientes) {
    const resultado = await avisarRecordatorio(recordatorio.appointment, {
      channel: recordatorio.channel,
      timezone: recordatorio.appointment.business?.timezone || 'UTC',
    });

    if (resultado.enviado) {
      await prisma.reminder.update({
        where: { id: recordatorio.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
      });
      enviados += 1;
    } else {
      /// Tres intentos y se marca FAILED. Mas alla de ahi no va a mejorar: si el
      /// destino no existe, reintentar toda la hora no lo hace aparecer, y solo
      /// carga la cola.
      const intentos = recordatorio.attempts + 1;

      await prisma.reminder.update({
        where: { id: recordatorio.id },
        data: {
          status: intentos >= 3 ? 'FAILED' : 'PENDING',
          attempts: intentos,
          lastError: resultado.motivo,
          /// Se aparta 15 minutos para no hammering en el mismo minuto de nuevo.
          ...(intentos < 3 ? { scheduledFor: new Date(Date.now() + 15 * 60_000) } : {}),
        },
      });

      fallidos += 1;
    }
  }

  return { enviados, fallidos, revisados: pendientes.length };
}

/**
 * Programa los recordatorios por defecto de las citas confirmadas que aun no
 * tienen ninguno. La corre el worker cada cierto tiempo.
 *
 * Se hace por lotes y no al coordinar la cita a proposito: pedir una cita no debe
 * escribir filas extra en la transaccion de la reserva, y si el worker esta parado
 * un rato lo que se pierde es un aviso, no la cita.
 */
export async function programarPendientes({ limite = 200 } = {}) {
  const negocios = await prisma.business.findMany({
    where: { activo: true, deletedAt: null },
    include: { settings: true },
  });

  let creados = 0;

  for (const negocio of negocios) {
    if (!negocio.settings?.remindersEnabled) continue;
    if (!negocio.settings?.emailEnabled) continue;

    const antes = negocio.settings.reminderBeforeMin;

    const citas = await prisma.appointment.findMany({
      where: {
        businessId: negocio.id,
        status: 'COORDINATED',
        deletedAt: null,
        reminders: { none: { status: { in: ['PENDING', 'SENT'] } } },
        /*
         * `parseDateOnly(hoyEn(...))`, nunca `hoyEn(...)` a secas.
         *
         * `hoyEn` devuelve un STRING ("2026-10-11") porque su destino habitual es
         * pintar o comparar fechas como texto. Prisma quiere un `Date` para un filtro de
         * rango: si se le pasa el string crudo responde "Invalid value for argument
         * gte: premature end of input. Expected ISO-8601 DateTime" y la tarea entera
         * revienta.
         *
         * El fallo era dificil de ver porque la tarea se salta los errores y el
         * proceso seguia en pie: los recordatorios simplemente nunca se programaban.
         */
        availability: { is: { date: { gte: parseDateOnly(hoyEn(negocio.timezone)) } } },
      },
      include: { availability: { select: { date: true, startTime: true } } },
      take: limite,
    });

    for (const cita of citas) {
      const instante = instanteEn(
        formatDateOnly(cita.availability.date),
        cita.availability.startTime,
        negocio.timezone
      );

      const scheduledFor = new Date(instante.getTime() - antes * 60_000);

      /// Si ya paso la ventana de aviso, no se programa: seria un recordatorio
      /// que llega tarde, que es peor que no llegar.
      if (scheduledFor <= new Date()) continue;

      await prisma.reminder.create({
        data: { appointmentId: cita.id, channel: 'EMAIL', scheduledFor },
      });

      creados += 1;
    }
  }

  return { creados };
}

export default { listFor, create, enviarPendientes, programarPendientes, createRules };
