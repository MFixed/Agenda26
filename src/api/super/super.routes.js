import { Router } from 'express';
import * as businessController from '../business/business.controllers.js';
import { authenticate, requireRole } from '../../middlewares/auth.js';

/**
 * Gestion de empresas desde el equipo de la plataforma.
 *
 * Solo agrupa y traduce HTTP: las reglas de una empresa viven en su propio
 * service, que es quien sabe crear negocios y mantener sus datos. Este router no
 * reimplementa nada, solo decide quien puede entrar.
 */
export const superRouter = Router();

superRouter.use(authenticate, requireRole('SUPERADMIN'));

superRouter.get('/negocios', businessController.listNegocios);

superRouter.post('/negocios', businessController.createNegocio);

/// El slug NO se puede editar: forma parte de la direccion publica
/// (/b/:slug/login) y cambiarlo rompe los enlaces ya repartidos. El service lo
/// ignora en silencio; el validation se encarga de no dejar pasar el campo.
superRouter.patch('/negocios/:id', businessController.updateNegocio);

/// Baja logica. Con ?hard=true borra en cascada de verdad: irreversible, y por eso
/// va aparte y no en el PATCH, donde un error de dedo no tiene vuelta atras.
superRouter.delete('/negocios/:id', businessController.deleteNegocio);

export default superRouter;
