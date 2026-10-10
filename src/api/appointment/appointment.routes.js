import { Router } from 'express';
import * as appointmentController from './appointment.controllers.js';
import { authenticate, requireRole } from '../../middlewares/auth.js';

export const appointmentRouter = Router();

appointmentRouter.use(authenticate);

const staff = requireRole('ADMIN', 'SUPERADMIN');
const cualquierRol = requireRole('ADMIN', 'SUPERADMIN', 'CLIENT');

// /resumen va antes que /:id para que "resumen" no se lea como un id.
appointmentRouter.get('/resumen', appointmentController.resumen);

appointmentRouter.get('/', appointmentController.list);
appointmentRouter.get('/:id', appointmentController.getById);

// El cliente puede pedir una cita para si mismo; el staff, en nombre de quien sea.
appointmentRouter.post('/', cualquierRol, appointmentController.create);

// Anotar y reprogramar son decisiones de la administracion.
appointmentRouter.put('/:id', staff, appointmentController.update);
appointmentRouter.delete('/:id', staff, appointmentController.remove);

appointmentRouter.post('/:id/coordinar', staff, appointmentController.coordinar);
appointmentRouter.post('/:id/completar', staff, appointmentController.completar);
appointmentRouter.post('/:id/rechazar', staff, appointmentController.rechazar);
appointmentRouter.post('/:id/cancelar-admin', staff, appointmentController.cancelarAdmin);
appointmentRouter.post('/:id/cancelar', cualquierRol, appointmentController.cancelar);