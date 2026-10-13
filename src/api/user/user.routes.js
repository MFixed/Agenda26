import { Router } from 'express';
import * as userController from './user.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

/**
 * Cuentas del negocio (nuevo en v2).
 *
 * Solo ADMIN y SUPERADMIN:STAFF gestiona citas, CLIENT pide citas. Dar de alta
 * cuentas es tarea de administracion.
 */
export const userRouter = Router();

userRouter.use(authenticate, requireRole('ADMIN', 'SUPERADMIN'), withBusiness);

userRouter.get('/', userController.list);
userRouter.post('/', userController.create);
userRouter.get('/:id', userController.detail);
userRouter.put('/:id', userController.update);
userRouter.delete('/:id', userController.remove);

export default userRouter;
