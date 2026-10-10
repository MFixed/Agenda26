import {
  optionalPattern,
  validateOrThrow,
  validatePattern
} from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

/**
 * Alta de negocio desde el panel de la plataforma. El negocio y su primer
 * administrador se crean juntos porque una empresa sin nadie que la administre
 * no tiene ninguna puerta abierta.
 */
export function createRules(body) {
  return validateOrThrow(
    {
      nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
      slug: validatePattern(body.slug, 'slug', 'slug'),
      descripcion: optionalPattern(body.descripcion, 'direccion', 'descripcion'),
      adminNombre: validatePattern(body.adminNombre, 'nombre', 'adminNombre'),
      adminEmail: validatePattern(body.adminEmail, 'email', 'adminEmail'),
      adminPassword: validatePattern(body.adminPassword, 'password', 'adminPassword'),
    },
    ApiError
  );
}

export function updateRules(body) {
  const validator = {};

  if (body.nombre !== undefined) {
    validator.nombre = validatePattern(body.nombre, 'nombre', 'nombre');
  }

  if (body.descripcion !== undefined) {
    validator.descripcion = optionalPattern(body.descripcion, 'direccion', 'descripcion');
  }

  // El identificador forma parte de la direccion publica de la empresa
  // (/b/:slug/login): cambiarlo rompe los enlaces ya repartidos.
  if (body.activo !== undefined) {
    if (typeof body.activo !== 'boolean') {
      validator.activo = { valid: false, message: 'activo debe ser booleano' };
    } else {
      validator.activo = { valid: true, value: body.activo };
    }
  }

  if (Object.keys(validator).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  return validateOrThrow(validator, ApiError);
}