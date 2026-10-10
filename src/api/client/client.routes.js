import { Router } from 'express';
import * as clientController from './client.controllers.js';
import { authenticate, requireRole } from '../../middlewares/auth.js';

export const clientRouter = Router();

clientRouter.use(authenticate);

const staff = requireRole('ADMIN', 'SUPERADMIN');

// El perfil del propio cliente va antes que /:id para que "me" no se lea como
// un identificador.
clientRouter.get('/me', requireRole('CLIENT'), clientController.getSelf);
clientRouter.put('/me', requireRole('CLIENT'), clientController.updateSelf);

clientRouter.get('/', staff, clientController.list);
clientRouter.post('/', staff, clientController.create);
clientRouter.get('/:id', staff, clientController.getById);
clientRouter.put('/:id', staff, clientController.update);
clientRouter.delete('/:id', staff, clientController.remove);