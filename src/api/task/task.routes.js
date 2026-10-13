import { Router } from 'express';
import * as taskController from './task.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const taskRouter = Router();

taskRouter.use(authenticate, withBusiness);

/// Un CLIENT ve sus propias tareas (el service lo filtra por `clientId`), pero no
/// puede crear ni editar las de otras. El STAFF gestiona las suyas y las de su
/// cartera.
taskRouter.get('/', taskController.list);
taskRouter.get('/:id', taskController.getById);
taskRouter.post('/', taskController.create);
taskRouter.put('/:id', taskController.update);

/// Borrar se lleva citas y datos por delante, asi que no es cosa del cliente.
taskRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), taskController.remove);

export default taskRouter;
