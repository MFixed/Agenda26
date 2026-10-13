import {
  optionalPattern,
  validateBool,
  validateOneOf,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';
import { ApiError } from '../../utils/ApiError.js';

export const ROLES = ['ADMIN', 'STAFF', 'CLIENT'];

/**
 * `negocio` es el identificador de la empresa con la que se entra. No es un
 * campo mas del formulario: es la puerta (/b/:slug/login) y decide en que empresa
 * se crea la cuenta. Solo el acceso de la plataforma (/login) entra sin el.
 */
function negocioRules(body, { obligatorio }) {
  const valor = body.negocio ?? body.businessSlug;

  if (!valor && !obligatorio) {
    return { valid: true, value: '' };
  }

  return validatePattern(valor, 'slug', 'negocio');
}

export function loginRules(body) {
  return validateOrThrow({
    email: validatePattern(body.email, 'email', 'email'),
    password: validatePattern(body.password, 'password', 'password'),
    negocio: negocioRules(body, { obligatorio: false }),
  });
}

export function registerRules(body) {
  const data = validateOrThrow({
    nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
    documento: validatePattern(body.documento, 'documento', 'documento'),
    fechaNacimiento: validatePattern(body.fechaNacimiento, 'date', 'fechaNacimiento'),
    email: validatePattern(body.email, 'email', 'email'),
    password: validatePattern(body.password, 'password', 'password'),
    confirmPassword: validatePattern(body.confirmPassword, 'password', 'confirmPassword'),
    telefono: optionalPattern(body.telefono, 'telefono', 'telefono'),
    direccion: optionalPattern(body.direccion, 'direccion', 'direccion'),
    negocio: negocioRules(body, { obligatorio: true }),
    /// Quien se registra puede pedir que se le avise por correo o no. Por
    /// defecto no: pedir el opt-in es obligatorio para poder mandarlos.
    emailOptIn: validateBool(body.emailOptIn ?? false, 'emailOptIn'),
  });

  if (data.password !== data.confirmPassword) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'confirmPassword', message: 'Las contrasenas no coinciden' },
    ]);
  }

  return data;
}

export function passwordRules(body) {
  const data = validateOrThrow({
    passwordActual: validatePattern(body.passwordActual, 'password', 'passwordActual'),
    passwordNueva: validatePattern(body.passwordNueva, 'password', 'passwordNueva'),
    confirmPassword: validatePattern(body.confirmPassword, 'password', 'confirmPassword'),
  });

  if (data.passwordNueva !== data.confirmPassword) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'confirmPassword', message: 'Las contrasenas no coinciden' },
    ]);
  }

  if (data.passwordNueva === data.passwordActual) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'passwordNueva', message: 'La nueva contrasena debe ser distinta de la actual' },
    ]);
  }

  return data;
}

/// Recuperar contrasena: solo el email. La contrasena nueva la pone el usuario
/// al restablecerla, no aqui: mandar un campo que se ignora solo hace ruido.
export function forgotRules(body) {
  return validateOrThrow({
    email: validatePattern(body.email, 'email', 'email'),
  });
}

export function resetRules(body) {
  const data = validateOrThrow({
    token: validatePattern(body.token, 'nombre', 'token'),
    password: validatePattern(body.password, 'password', 'password'),
    confirmPassword: validatePattern(body.confirmPassword, 'password', 'confirmPassword'),
  });

  if (data.password !== data.confirmPassword) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'confirmPassword', message: 'Las contrasenas no coinciden' },
    ]);
  }

  return data;
}

export function refreshRules(body) {
  return validateOrThrow({
    refreshToken: validatePattern(body.refreshToken, 'nombre', 'refreshToken'),
  });
}

export function settingsRules(body) {
  return validatePatch({
    emailOptIn: body.emailOptIn === undefined ? undefined : validateBool(body.emailOptIn, 'emailOptIn'),
    locale: body.locale === undefined ? undefined : validatePattern(body.locale, 'nombre', 'locale'),
    timezone:
      body.timezone === undefined || body.timezone === ''
        ? { valid: true, value: null }
        : validatePattern(body.timezone, 'timezone', 'timezone'),
    theme:
      body.theme === undefined ? undefined : validateOneOf(body.theme, ['system', 'light', 'dark'], 'theme'),
  });
}

export default {
  ROLES,
  loginRules,
  registerRules,
  passwordRules,
  forgotRules,
  resetRules,
  refreshRules,
  settingsRules,
};
