import * as notificationService from './service/notification.service.js';

export async function list(req, res) {
  const onlyUnread = req.query.unread === 'true';
  res.json(await notificationService.list(req.user.id, { onlyUnread, limit: req.query.limit }));
}

export async function markAsRead(req, res) {
  res.json(await notificationService.markAsRead(req.user.id, Number(req.params.id)));
}

export async function markAllAsRead(req, res) {
  res.json(await notificationService.markAllAsRead(req.user.id));
}

export async function unreadCount(req, res) {
  res.json({ unread: await notificationService.unreadCount(req.user.id) });
}