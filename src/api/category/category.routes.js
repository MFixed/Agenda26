import { Router } from 'express';
import * as categoryController from './category.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const categoryRouter = Router();

categoryRouter.use(authenticate, withBusiness);

/**
 * El cliente necesita el catalogo para elegir servicio al pedir una cita, pero no
 * puede crearlo ni cambiarlo. Un STAFF si lo consulta para atender.
 */
categoryRouter.get('/', categoryController.list);
categoryRouter.post('/', requireRole('ADMIN', 'SUPERADMIN'), categoryController.create);
categoryRouter.get('/:id', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), categoryController.detail);
categoryRouter.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), categoryController.update);
categoryRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), categoryController.remove);

export default categoryRouter;
