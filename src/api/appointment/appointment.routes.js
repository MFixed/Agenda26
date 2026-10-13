import { Router } from 'express';
import * as appointmentController from './appointment.controllers.js';
import * as reminderController from './service/reminder.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const appointmentRouter = Router();

appointmentRouter.use(authenticate, withBusiness);

const staff = requireRole('ADMIN', 'STAFF', 'SUPERADMIN');
const cualquierRol = requireRole('ADMIN', 'STAFF', 'SUPERADMIN', 'CLIENT');

/// /resumen va antes que /:id para que "resumen" no se lea como un id.
appointmentRouter.get('/resumen', appointmentController.resumen);

appointmentRouter.get('/', appointmentController.list);
appointmentRouter.get('/:id', appointmentController.getById);

/**
 * El cliente puede pedir una cita para si mismo; el staff, en nombre de quien sea.
 * Un STAFF entra aqui tambien: es quien agenda en mostrador.
 */
appointmentRouter.post('/', cualquierRol, appointmentController.create);

/// Anotar y reprogramar son decisiones de la administracion.
appointmentRouter.put('/:id', staff, appointmentController.update);
appointmentRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), appointmentController.remove);

/// Las acciones de estado van cada una por su ruta, con su propio permiso.
appointmentRouter.post('/:id/coordinar', staff, appointmentController.coordinar);
appointmentRouter.post('/:id/completar', staff, appointmentController.completar);
appointmentRouter.post('/:id/rechazar', staff, appointmentController.rechazar);
appointmentRouter.post('/:id/cancelar-admin', staff, appointmentController.cancelarAdmin);
appointmentRouter.post('/:id/cancelar', cualquierRol, appointmentController.cancelar);

/** Ausencia (nuevo en v2). Solo el equipo: el cliente no se marca ausente a si mismo. */
appointmentRouter.post('/:id/no-show', staff, appointmentController.noShow);

/** Registro de llegada (nuevo en v2). Sala de espera. */
appointmentRouter.post('/:id/checkin', staff, appointmentController.checkin);

/** Recordatorios de la cita (nuevo en v2). */
appointmentRouter.get('/:id/reminders', staff, reminderController.listFor);
appointmentRouter.post('/:id/reminders', staff, reminderController.create);

export default appointmentRouter;
