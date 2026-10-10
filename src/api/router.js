import { Router } from 'express';
import { authRouter } from './auth/auth.routes.js';
import { businessRouter } from './business/business.routes.js';
import { superRouter } from './super/super.routes.js';
import { clientRouter } from './client/client.routes.js';
import { categoryRouter } from './category/category.routes.js';
import { taskRouter } from './task/task.routes.js';
import { availabilityRouter } from './availability/availability.routes.js';
import { appointmentRouter } from './appointment/appointment.routes.js';
import { notificationRouter } from './notification/notification.routes.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use('/auth', authRouter);
router.use('/negocios', businessRouter);
router.use('/super', superRouter);
router.use('/clients', clientRouter);
router.use('/categories', categoryRouter);
router.use('/tasks', taskRouter);
router.use('/availability', availabilityRouter);
router.use('/appointments', appointmentRouter);
router.use('/notifications', notificationRouter);