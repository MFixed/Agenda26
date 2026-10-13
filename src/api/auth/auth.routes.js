import { Router } from 'express';
import * as authController from './auth.controllers.js';
import { authenticate } from '../../middlewares/auth.js';
import { limitadores } from '../../middlewares/rateLimit.js';

export const authRouter = Router();

/**
 * El limite del login va en la ruta, no en el router general: cuenta intentos
 * fallidos por email, y un limite global no puede saber si un intento fue
 * fallido o no. El registro tambien va limitado aqui, porque es la otra puerta
 * abierta: sin tope, cualquiera puede crear cuentas en masa.
 *
 * Recuperar contrasena va con su propio limite, mas cerrado: cada peticion
 * dispara un correo real, y sin tope cualquiera puede usar la app como un
 * generador de spam con el dominio de la empresa.
 */
/**
 * El limite del login va en la ruta, no en el router general: cuenta intentos
 * fallidos por email, y un limite global no puede saber si un intento fue
 * fallido o no.
 *
 * El registro NO usa ese limitador: el suyo va por `${ip}:${email}` y solo cuenta
 * los fallos, asi que un atacante con cuentas de correo distintas recibia un
 * cubo vacio en cada peticion y podia crear cuentas en masa sin toparse nunca.
 * `limitadores.registro` va por IP y cuenta tambien los successes.
 *
 * Recuperar contrasena va con su propio limite, mas cerrado: cada peticion
 * dispara un correo real, y sin tope cualquiera puede usar la app como un
 * generador de spam con el dominio de la empresa.
 */
authRouter.post('/register', limitadores.registro, authController.register);
authRouter.post('/login', limitadores.login, authController.login);
authRouter.post('/forgot-password', limitadores.recuperacion, authController.forgotPassword);
authRouter.post('/reset-password', limitadores.recuperacion, authController.resetPassword);
authRouter.post('/refresh', limitadores.login, authController.refresh);

authRouter.get('/me', authenticate, authController.me);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.post('/password', authenticate, authController.changePassword);

/// Sesiones activas: quien entro desde que navegador y cuando. "Cerrar sesion en
/// todos los dispositivos" es una funcion que la gente da por hecha y aqui si
/// existe.
authRouter.get('/sessions', authenticate, authController.listSessions);
authRouter.delete('/sessions/:id', authenticate, authController.revokeSession);

/// Preferencias del usuario (opt-in de correo, tema, zona).
authRouter.get('/settings', authenticate, authController.getSettings);
authRouter.patch('/settings', authenticate, authController.updateSettings);

export default authRouter;
