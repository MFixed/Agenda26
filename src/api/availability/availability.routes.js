import { Router } from 'express';
import * as availabilityController from './availability.controllers.js';
import { authenticate, requireRole } from '../../middlewares/auth.js';

export const availabilityRouter = Router();

availabilityRouter.use(authenticate);

const staff = requireRole('ADMIN', 'SUPERADMIN');

// Consultar es abierto a todos (el cliente necesita ver los huecos libres);
// publicar y editar horarios es solo de la administracion.
availabilityRouter.get('/', availabilityController.list);
availabilityRouter.get('/:id', availabilityController.getById);

availabilityRouter.post('/', staff, availabilityController.create);
availabilityRouter.put('/:id', staff, availabilityController.update);
availabilityRouter.delete('/:id', staff, availabilityController.remove);