import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';

/** Cada usuario solo ve sus propias notificaciones. */
export async function list(userId, { onlyUnread, limit = 50 } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(onlyUnread ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 50, 200),
  });
}

export async function markAsRead(userId, id) {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });

  if (!notification) {
    throw ApiError.notFound('Notificacion no encontrada');
  }

  if (notification.readAt) {
    return notification;
  }

  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllAsRead(userId) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { updated: count };
}

export async function unreadCount(userId) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}