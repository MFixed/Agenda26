import * as authService from './service/auth.service.js';
import { loginRules, passwordRules, registerRules } from './auth.regex.js';

export async function login(req, res) {
  res.json(await authService.login(loginRules(req.body)));
}

export async function register(req, res) {
  res.status(201).json(await authService.register(registerRules(req.body)));
}

export async function me(req, res) {
  res.json(await authService.me(req.user.id));
}

/**
 * Cierre de sesion de verdad: sube la version del token del usuario, con lo que
 * todos sus tokens dejan de valer en la siguiente peticion. Antes esto solo
 * respondia 204 y el token seguido sirviendo hasta que caducaba.
 */
export async function logout(req, res) {
  await authService.logout(req.user.id);
  res.status(204).end();
}

export async function changePassword(req, res) {
  res.json(await authService.changePassword(req.user.id, passwordRules(req.body)));
}