import {
  optionalPattern,
  validateBool,
  validateInt,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';

/**
 * Catalogo de servicios.
 *
 * v2 anade `durationMin`: la duracion es lo que decide cuanto ocupa un servicio en
 * la agenda. Sin ella, un servicio de 15 minutos y otro de 2 horas ocupaban
 * exactamente el mismo hueco, que es como un sistema de citas no puede funcionar.
 */
export function createRules(body) {
  return validateOrThrow({
    name: validatePattern(body.name, 'nombre', 'name'),
    description: optionalPattern(body.description, 'nombre', 'description'),
    durationMin: validateInt(body.durationMin ?? 60, 'durationMin', { min: 5, max: 480 }),
    color: optionalPattern(body.color, 'hex', 'color'),
    precio:
      body.precio === undefined || body.precio === ''
        ? { valid: true, value: null }
        : { valid: true, value: Number(body.precio) },
    activo: validateBool(body.activo ?? true, 'activo'),
  });
}

export function updateRules(body) {
  const validator = {};

  if (body.name !== undefined) validator.name = validatePattern(body.name, 'nombre', 'name');

  if (body.description !== undefined) {
    validator.description = body.description
      ? validatePattern(body.description, 'nombre', 'description')
      : { valid: true, value: null };
  }

  if (body.durationMin !== undefined) {
    validator.durationMin = validateInt(body.durationMin, 'durationMin', { min: 5, max: 480 });
  }

  if (body.color !== undefined) validator.color = optionalPattern(body.color, 'hex', 'color');

  if (body.precio !== undefined) {
    validator.precio =
      body.precio === '' ? { valid: true, value: null } : { valid: true, value: Number(body.precio) };
  }

  if (body.activo !== undefined) validator.activo = validateBool(body.activo, 'activo');

  return validatePatch(validator);
}

export default { createRules, updateRules };
