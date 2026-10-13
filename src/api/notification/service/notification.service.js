import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';

/** Cada usuario solo ve sus propias notificaciones. */
export async function list(userId, { onlyUnread, limit } = {}) {
  return prisma.notification.findMany({
    where: { userId, deletedAt: null, ...(onlyUnread ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 50, 200),
  });
}

/**
 * Marcar una como leida.
 *
 * El `userId` va en el where y no solo en el find: sin el, `markAsRead` comprobaria
 * que la notificacion existe (de cualquiera) y despues actualizaria la que fuera.
 * Con el, un usuario no puede marcar leida la notificacion de otro ni siquiera por
 * error de id.
 */
export async function markAsRead(userId, id) {
  const notification = await prisma.notification.findFirst({
    where: { id, userId, deletedAt: null },
  });

  if (!notification) throw ApiError.notFound('Notificacion no encontrada');

  if (notification.readAt) return notification;

  return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllAsRead(userId) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, deletedAt: null, readAt: null },
    data: { readAt: new Date() },
  });

  return { updated: count };
}

export async function unreadCount(userId) {
  return prisma.notification.count({ where: { userId, deletedAt: null, readAt: null } });
}

/**
 * Borra las propias notificaciones (nuevo en v2).
 *
 * Baja logica, no fisica: el registro de que a un cliente se le aviso de una cita
 * forma parte del historial, y no va a ser el cliente quien pueda exigir que se
 * lea. El worker de purga se encarga de lo que ya no sirve de nada.
 */
export async function remove(userId, id) {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (count === 0) throw ApiError.notFound('Notificacion no encontrada');
}

/**
 * Purga las notificaciones leidas mas antiguas que el corte (nuevo en v2).
 *
 * La corre el worker. Sin esto la tabla crece sin limite: cada cambio de estado de
 * cita escribe una fila, y una empresa con trafico normal genera cientos al dia que
 * ya no sirven para nada.
 */
export async function purgar(dias) {
  const corte = new Date(Date.now() - dias * 86_400_000);

  const { count } = await prisma.notification.deleteMany({
    where: { readAt: { not: null, lt: corte } },
  });

  return count;
}

export default { list, markAsRead, markAllAsRead, unreadCount, remove, purgar };
