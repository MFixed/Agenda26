import * as authService from './service/auth.service.js';
import * as recoveryService from './service/recovery.service.js';
import {
  forgotRules,
  loginRules,
  passwordRules,
  refreshRules,
  registerRules,
  resetRules,
  settingsRules,
} from './auth.validation.js';

export async function register(req, res) {
  res.status(201).json(await authService.register(registerRules(req.body), req));
}

export async function login(req, res) {
  res.json(await authService.login(loginRules(req.body), req));
}

export async function me(req, res) {
  res.json(await authService.me(req.user.id));
}

/**
 * Cierre de sesion. Acepta `?todos=1` para revocar todas las sesiones del
 * usuario en lugar de solo la actual.
 */
export async function logout(req, res) {
  await authService.logout(req.user.id, req.body?.refreshToken, { todos: req.query.todos === 'true' });
  res.status(204).end();
}

export async function refresh(req, res) {
  res.json(await authService.refresh(refreshRules(req.body).refreshToken, req));
}

export async function changePassword(req, res) {
  res.json(await authService.changePassword(req.user.id, passwordRules(req.body), req));
}

export async function forgotPassword(req, res) {
  /// Siempre 200, exista o no el correo. Decirlo distinto confirma que el correo
  /// esta registrado, que es justo lo que hay que evitar.
  res.json(await recoveryService.forgot(forgotRules(req.body).email));
}

export async function resetPassword(req, res) {
  res.json(await recoveryService.reset(resetRules(req.body), req));
}

export async function listSessions(req, res) {
  res.json({ items: await authService.listSessions(req.user.id) });
}

export async function revokeSession(req, res) {
  await authService.revokeSession(req.user.id, Number(req.params.id));
  res.status(204).end();
}

export async function getSettings(req, res) {
  res.json({ settings: await authService.getSettings(req.user.id) });
}

export async function updateSettings(req, res) {
  res.json({ settings: await authService.updateSettings(req.user.id, settingsRules(req.body)) });
}

export default {
  register,
  login,
  me,
  logout,
  refresh,
  changePassword,
  forgotPassword,
  resetPassword,
  listSessions,
  revokeSession,
  getSettings,
  updateSettings,
};
