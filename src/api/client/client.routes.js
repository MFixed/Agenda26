import { Router } from 'express';
import * as clientController from './client.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const clientRouter = Router();

clientRouter.use(authenticate, withBusiness);

/// El perfil del propio cliente va antes que /:id para que "me" no se lea como un
/// identificador.
clientRouter.get('/me', requireRole('CLIENT'), clientController.getSelf);
clientRouter.put('/me', requireRole('CLIENT'), clientController.updateSelf);

/// El CLIENT puede ver SU historial. Es lo suyo: no hay nada sensible que ver y
/// le evita tener que llamar para preguntar cuando fue por ultima vez.
clientRouter.get('/me/history', requireRole('CLIENT'), (req, res, next) => {
  req.params.id = req.user.clientId;
  clientController.history(req, res, next);
});

clientRouter.get('/', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), clientController.list);
clientRouter.post('/', requireRole('ADMIN', 'SUPERADMIN'), clientController.create);
clientRouter.get('/:id', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), clientController.getById);
clientRouter.get('/:id/history', requireRole('ADMIN', 'STAFF', 'SUPERADMIN'), clientController.history);
clientRouter.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), clientController.update);
clientRouter.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), clientController.remove);

export default clientRouter;
