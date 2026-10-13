import { Router } from 'express';
import * as reportController from './report.controllers.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

export const reportRouter = Router();

/**
 * Informes (nuevo en v2).
 *
 * Solo ADMIN y SUPERADMIN. Un STAFF ve su propia agenda; los informes del negocio
 * son de la administracion. Un CLIENT solo ve las SUYAS cifras, y eso ya lo
 * devuelve `/appointments/resumen`.
 */
reportRouter.use(authenticate, requireRole('ADMIN', 'SUPERADMIN'), withBusiness);

reportRouter.get('/overview', reportController.overview);
reportRouter.get('/occupancy', reportController.occupancy);
reportRouter.get('/services', reportController.services);
reportRouter.get('/cancellations', reportController.cancellations);
reportRouter.get('/no-show', reportController.noShow);
reportRouter.get('/export', reportController.exportCsv);

export default reportRouter;
