import { Router } from 'express';
import * as businessController from './business.controllers.js';

export const businessRouter = Router();

// Publicas: son la puerta de entrada. Quien todavia no ha entrado es justo
// quien necesita saber el nombre de la empresa a la que va a entrar.
businessRouter.get('/', businessController.list);
businessRouter.get('/:slug', businessController.getBySlug);