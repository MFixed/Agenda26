import { Router } from 'express';
import * as notificationController from './notification.controllers.js';
import { authenticate } from '../../middlewares/auth.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.get('/', notificationController.list);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.patch('/read-all', notificationController.markAllAsRead);
notificationRouter.patch('/:id/read', notificationController.markAsRead);

/// Descartar una notificacion (nuevo en v2). Nunca borra de verdad: el registro de
/// que se le aviso forma parte del historial.
notificationRouter.delete('/:id', notificationController.remove);

export default notificationRouter;
