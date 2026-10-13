import { registrarTarea } from './scheduler.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { expirarHolds } from '../api/availability/service/availability.service.js';
import { purgar as purgarNotificaciones } from '../api/notification/service/notification.service.js';
import { expirarVencidas } from '../api/staff/service/waitlist.service.js';
import { enviarPendientes, programarPendientes } from '../api/appointment/service/reminder.service.js';
import { prisma } from '../../config/driver.js';
import { hoyEn, parseDateOnly } from '../utils/dates.js';

/**
 * Las tareas que se ejecutan solas.
 *
 * Todas son idempotentes y barato cuando no hay nada que hacer: se pueden correr
 * cada minuto sin coste apreciable, que es lo que permite no tener que pensar en
 * "cuanto falta para el siguiente".
 */

/**
 * Devuelve a AVAILABLE los huecos cuya retencion caduco.
 *
 * Sin esto, un cliente que abria el formulario y se iba sin reservar dejaba el
 * bloque apartado indefinidamente. Es la funcion mas importante de todas: el
 * nombre HELD no sirve de nada si nadie lo limpia.
 */
registrarTarea('expirar-retenciones', expirarHolds);

/** Caduca las entradas de lista de espera que nadie atendio a tiempo. */
registrarTarea('expirar-lista-espera', async () => ({ expiradas: await expirarVencidas() }));

/**
 * Programa los recordatorios de las citas confirmadas que aun no tienen ninguno.
 *
 * Va ANTES de enviarlos en la misma ronda, con el orden importa: si se invirtiera,
 * un recordatorio recien programado se mandaria en la ronda siguiente, con hasta un
 * minuto de retraso, que no es nada pero tampoco hace falta.
 */
registrarTarea('programar-recordatorios', () => programarPendientes());

/** Envia los recordatorios que ya tocaban. */
registrarTarea('enviar-recordatorios', () => enviarPendientes());

/**
 * Purga de notificaciones leidas y antiguas.
 *
 * Sin esto la tabla crece sin limite: cada cambio de estado de cita escribe una
 * fila, y una empresa con trafico normal genera cientos al dia que ya no sirven
 * para nada. Se borran las LEIDAS y no las sin leer: lo que el usuario no ha visto
 * todavia le importa.
 */
registrarTarea('purgar-notificaciones', () => purgarNotificaciones(env.notificationRetentionDays));

/**
 * Limpieza de retenciones huerfanas.
 *
 * Un token de refresco caducado sigue ocupando fila, y un token de recuperacion
 * usado tambien. Se van solos a los 30 dias.
 */
registrarTarea('purgar-tokens', async () => {
  const [refresh, reset] = await Promise.all([
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } }),
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
          { usedAt: { not: null, lt: new Date(Date.now() - 7 * 86_400_000) } },
        ],
      },
    }),
  ]);

  return { refresh: refresh.count, reset: reset.count };
});

/**
 * Aviso de las citas de hoy que siguen sin coordinar.
 *
 * No es un recordatorio al cliente (eso lo hace el sistema de recordatorios), sino
 * una linea en el log para el negocio: "tienes 3 citas de hoy sin confirmar" es
 * exactamente el aviso que evita que alguien se presente y no haya nadie.
 */
registrarTarea('avisar-sin-coordinar', async () => {
  // El 'hoy' de cada empresa se calcula en SU zona horaria, no en la del servidor.
  // Y parseDateOnly porque Prisma quiere un Date en un filtro de rango.

  const negocios = await prisma.business.findMany({
    where: { activo: true, deletedAt: null },
    select: { id: true, nombre: true, timezone: true },
  });

  let total = 0;

  for (const negocio of negocios) {
    /*
     * El rango tiene que cerrar en HOY, no solo empezar en hoy.
     *
     * Con `gte` solo, este contador contaba cada cita PENDING desde hoy hasta el
     * final de los tiempos: el numero no bajaba nunca y el log de "citas sin
     * coordinar" acababa lleno de cientos de citas de dentro de seis meses, que es
     * justo lo contrario de lo que sirve para enterarse de lo de manana.
     *
     * "Hoy" va de las 00:00 a las 23:59:59 en la zona de la empresa.
     */
    const hoy = parseDateOnly(hoyEn(negocio.timezone));
    const finDeHoy = new Date(hoy.getTime() + 24 * 60 * 60 * 1000 - 1);

    const pendientes = await prisma.appointment.count({
      where: {
        businessId: negocio.id,
        status: 'PENDING',
        deletedAt: null,
        availability: { is: { date: { gte: hoy, lte: finDeHoy } } },
      },
    });

    if (pendientes > 0) {
      total += pendientes;
      logger.warn('citas sin coordinar', { negocio: negocio.nombre, pendientes });
    }
  }

  return total > 0 ? { pendientes: total } : { pendientes: 0 };
});

export default {};
