import {
  optionalPattern,
  validateOrThrow,
  validatePattern
} from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

/**
 * `negocio` es el identificador de la empresa con la que se entra. No es un
 * campo mas del formulario: es la puerta (/b/:slug/login) y decide en que
 * empresa se crea la cuenta. Solo el acceso de la plataforma (/login) entra
 * sin él.
 */
function negocioRules(body, { obligatorio }) {
  const valor = body.negocio ?? body.businessSlug;

  if (!valor && !obligatorio) {
    return { valid: true, value: '' };
  }

  return validatePattern(valor, 'slug', 'negocio');
}

export function loginRules(body) {
  return validateOrThrow(
    {
      email: validatePattern(body.email, 'email', 'email'),
      password: validatePattern(body.password, 'password', 'password'),
      negocio: negocioRules(body, { obligatorio: false }),
    },
    ApiError
  );
}

export function registerRules(body) {
  const data = validateOrThrow(
    {
      nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
      documento: validatePattern(body.documento, 'documento', 'documento'),
      fechaNacimiento: validatePattern(body.fechaNacimiento, 'date', 'fechaNacimiento'),
      email: validatePattern(body.email, 'email', 'email'),
      password: validatePattern(body.password, 'password', 'password'),
      confirmPassword: validatePattern(body.confirmPassword, 'password', 'confirmPassword'),
      telefono: optionalPattern(body.telefono, 'telefono', 'telefono'),
      direccion: optionalPattern(body.direccion, 'direccion', 'direccion'),
      negocio: negocioRules(body, { obligatorio: true }),
    },
    ApiError
  );

  if (data.password !== data.confirmPassword) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'confirmPassword', message: 'Las contrasenas no coinciden' },
    ]);
  }

  return data;
}

export function passwordRules(body) {
  const data = validateOrThrow(
    {
      passwordActual: validatePattern(body.passwordActual, 'password', 'passwordActual'),
      passwordNueva: validatePattern(body.passwordNueva, 'password', 'passwordNueva'),
      confirmPassword: validatePattern(body.confirmPassword, 'password', 'confirmPassword'),
    },
    ApiError
  );

  if (data.passwordNueva !== data.confirmPassword) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'confirmPassword', message: 'Las contrasenas no coinciden' },
    ]);
  }

  return data;
}