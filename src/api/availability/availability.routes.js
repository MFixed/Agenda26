import { Router } from 'express';
import * as availabilityController from './availability.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const availabilityRouter = Router();

availabilityRouter.use(authenticate, withBusiness);

availabilityRouter.get('/', availabilityController.list);
availabilityRouter.get('/:id', availabilityController.getById);

availabilityRouter.post('/', requireRole('ADMIN', 'SUPERADMIN'), availabilityController.create);
availabilityRouter.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), availabilityController.update);
availabilityRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), availabilityController.remove);

/**
 * Retener un hueco mientras el cliente completa la reserva (nuevo en v2).
 *
 * Abierto a cualquier autenticado, incluido el CLIENT: es justo el cliente quien
 * necesita que el hueco no se le escape mientras escribe.
 */
availabilityRouter.post('/:id/hold', availabilityController.hold);
availabilityRouter.delete('/:id/hold', availabilityController.releaseHold);

export default availabilityRouter;
