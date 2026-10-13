import { Router } from 'express';
import * as businessController from './business.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const businessRouter = Router();

/**
 * Ajustes del negocio: retencion de huecos, recordatorios, canales.
 *
 * `withBusiness` carga la empresa con su configuracion una sola vez y la deja en
 * `req.business`. El service de agenda la usa para el `timezone` y el `bufferMin`
 * sin volver a consultar.
 *
 * Esta ruta se declara ANTES de `/:slug` a proposito. Al reves, un GET a
 * /negocios/settings se interpretaria como "la empresa cuyo slug es 'settings'" y
 * devolveria un 404 en vez de los ajustes.
 */
businessRouter.get(
  '/settings',
  authenticate,
  requireRole('ADMIN', 'SUPERADMIN'),
  withBusiness,
  businessController.getSettings
);

businessRouter.patch(
  '/settings',
  authenticate,
  requireRole('ADMIN', 'SUPERADMIN'),
  withBusiness,
  businessController.updateSettings
);

/**
 * Publicas: son la puerta de entrada. Quien todavia no ha entrado es justo quien
 * necesita saber el nombre de la empresa a la que va a entrar.
 *
 * No llevan `authenticate` a proposito: el login de /b/:slug tiene que poder pintar
 * el nombre del negocio antes de que exista una sesion.
 */
businessRouter.get('/', businessController.list);
businessRouter.get('/:slug', businessController.getBySlug);

export default businessRouter;
