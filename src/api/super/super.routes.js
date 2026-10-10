import { Router } from 'express';
import * as superController from './super.controllers.js';
import { authenticate, requireRole } from '../../middlewares/auth.js';

/** Gestion de empresas desde el equipo de la plataforma. */
export const superRouter = Router();

superRouter.use(authenticate, requireRole('SUPERADMIN'));

superRouter.get('/negocios', superController.listNegocios);
superRouter.post('/negocios', superController.createNegocio);
superRouter.patch('/negocios/:id', superController.updateNegocio);