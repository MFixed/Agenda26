import { Router } from 'express';
import * as staffController from './staff.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

/**
 * Profesionales del negocio (nuevo en v2).
 *
 * Un STAFF gestiona su propia agenda; un ADMIN y un SUPERADMIN gestionan la de
 * todos. Un CLIENT no entra aqui: elige profesional al pedir cita.
 */
export const staffRouter = Router();

staffRouter.use(authenticate, withBusiness);

staffRouter.get('/', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), staffController.list);
staffRouter.post('/', requireRole('ADMIN', 'SUPERADMIN'), staffController.create);
staffRouter.get('/:id', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), staffController.detail);
staffRouter.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), staffController.update);
staffRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), staffController.remove);

/**
 * Plantillas de agenda recurrente (nuevo en v2).
 *
 * Publicar y editar horarios es administracion. Un STAFF puede GENERAR bloques a
 * partir de la plantilla que ya existe (que es lo que hace quien atiende), pero no
 * cambiar la plantilla: cambiarla afecta a toda la empresa.
 */
export const scheduleRouter = Router();

scheduleRouter.use(authenticate, withBusiness);

scheduleRouter.get('/', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), staffController.listSchedules);
scheduleRouter.post('/', requireRole('ADMIN', 'SUPERADMIN'), staffController.createSchedule);
scheduleRouter.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), staffController.updateSchedule);
scheduleRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), staffController.removeSchedule);

/// Generar bloques a partir de las plantillas. Lo puede hacer un STAFF: es lo que
/// hace quien lleva la agenda del dia a dia.
scheduleRouter.post(
  '/generate',
  requireRole('ADMIN', 'STAFF', 'SUPERADMIN'),
  staffController.generateSchedule
);

/** Lista de espera (nuevo en v2). Un CLIENT puede apuntarse a si mismo. */
export const waitlistRouter = Router();

waitlistRouter.use(authenticate, withBusiness);

waitlistRouter.get('/', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), staffController.listWaitlist);
waitlistRouter.post('/', staffController.createWaitlist);
waitlistRouter.delete('/:id', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), staffController.removeWaitlist);

export default staffRouter;
