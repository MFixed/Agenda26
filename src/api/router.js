import { Router } from 'express';
import { ping } from '../../config/driver.js';
import { authRouter } from './auth/auth.routes.js';
import { businessRouter } from './business/business.routes.js';
import { superRouter } from './super/super.routes.js';
import { userRouter } from './user/user.routes.js';
import { staffRouter, scheduleRouter, waitlistRouter } from './staff/staff.routes.js';
import { clientRouter } from './client/client.routes.js';
import { categoryRouter } from './category/category.routes.js';
import { taskRouter } from './task/task.routes.js';
import { availabilityRouter } from './availability/availability.routes.js';
import { appointmentRouter } from './appointment/appointment.routes.js';
import { notificationRouter } from './notification/notification.routes.js';
import { reportRouter } from './report/report.routes.js';
import { auditRouter } from './audit/audit.routes.js';

export const router = Router();

/**
 * Liveness: el proceso esta vivo y responde.
 *
 * NO consulta la base, a proposito. Si lo hiciera, con la base caida devolveria 503 y
 * el orquestador mataria justo los procesos que estan vivos y esperando a que la base
 * vuelva, que es cuando mas servicio hacen. Y cada 3 segundos por encima.
 */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

/**
 * Readiness: el proceso puede atender peticiones de verdad.
 *
 * Este SI consulta la base. Es el que decide si el proceso entra en el balanceador:
 * con la base caida responde 503 y el trafico se va a otro sitio. Sin esto, un
 * despliegue con la migracion a medias deja un servicio que parece sano y solo falla
 * cuando un usuario abre la agenda.
 */
router.get('/ready', async (_req, res) => {
  try {
    const db = await ping();
    res.json({ status: 'ok', db });
  } catch {
    /// El motivo exacto no sale: "sin conexion" basta para el monitor y no expone
    /// el host de la base a quien consulte el endpoint.
    res.status(503).json({
      status: 'error',
      db: { ok: false, motivo: 'sin conexion a la base de datos' },
    });
  }
});

/** Alias con el nombre que usan los probes de Kubernetes. Es lo mismo. */
router.get('/health/ready', async (_req, res) => {
  try {
    await ping();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

router.use('/auth', authRouter);

/// Publicas: son la puerta de entrada.
router.use('/negocios', businessRouter);
router.use('/super', superRouter);

/// Del resto se encarga cada router de exigir su sesion y su negocio.
router.use('/users', userRouter);
router.use('/staff', staffRouter);
router.use('/schedules', scheduleRouter);
router.use('/clients', clientRouter);
router.use('/categories', categoryRouter);
router.use('/tasks', taskRouter);
router.use('/availability', availabilityRouter);
router.use('/appointments', appointmentRouter);
router.use('/waitlist', waitlistRouter);
router.use('/notifications', notificationRouter);
router.use('/reports', reportRouter);
router.use('/audit', auditRouter);

export default router;
