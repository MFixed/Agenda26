import { validatePattern, validateOrThrow } from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

export function createRules(body) {
  return validateOrThrow(
    {
      name: validatePattern(body.name, 'nombre', 'name'),
      description: body.description
        ? validatePattern(body.description, 'nombre', 'description')
        : { valid: true, value: null },
    },
    ApiError
  );
}

export function updateRules(body) {
  const validator = {};

  if (body.name !== undefined) {
    validator.name = validatePattern(body.name, 'nombre', 'name');
  }

  if (body.description !== undefined) {
    validator.description = body.description
      ? validatePattern(body.description, 'nombre', 'description')
      : { valid: true, value: null };
  }

  if (Object.keys(validator).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  return validateOrThrow(validator, ApiError);
}