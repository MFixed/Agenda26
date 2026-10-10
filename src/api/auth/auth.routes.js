import { Router } from 'express';
import * as authController from './auth.controllers.js';
import { authenticate } from '../../middlewares/auth.js';
import { limitadores } from '../../middlewares/rateLimit.js';

export const authRouter = Router();

// El limite del login va en la ruta, no en el router general: cuenta intentos
// fallidos por email, y un limite global no puede saber si un intento fue
// fallido o no. El registro tambien va limitado aqui, porque es la otra puerta
// abierta: sin tope, cualquiera puede crear cuentas en masa.
authRouter.post('/register', limitadores.login, authController.register);
authRouter.post('/login', limitadores.login, authController.login);

authRouter.get('/me', authenticate, authController.me);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.post('/password', authenticate, authController.changePassword);