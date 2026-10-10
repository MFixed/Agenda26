import { Router } from 'express';
import * as categoryController from './category.controllers.js';
import { authenticate, requireRole } from '../../middlewares/auth.js';

export const categoryRouter = Router();

categoryRouter.use(authenticate);

const staff = requireRole('ADMIN', 'SUPERADMIN');

// El cliente necesita el catalogo para elegir servicio al pedir una cita, pero
// no puede crearlo ni cambiarlo.
categoryRouter.get('/', categoryController.list);
categoryRouter.post('/', staff, categoryController.create);
categoryRouter.put('/:id', staff, categoryController.update);
categoryRouter.delete('/:id', staff, categoryController.remove);