import {
  optionalPattern,
  validateOrThrow,
  validatePattern
} from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

/**
 * Ficha del cliente. El email y la contrasena no estan aqui: viven en la cuenta
 * de usuario, y el rol y el estado de esa cuenta los decide la administracion,
 * no el formulario.
 */
function fichaRules(body) {
  return validateOrThrow(
    {
      nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
      documento: validatePattern(body.documento, 'documento', 'documento'),
      fechaNacimiento: validatePattern(body.fechaNacimiento, 'date', 'fechaNacimiento'),
      email: validatePattern(body.email, 'email', 'email'),
      telefono: optionalPattern(body.telefono, 'telefono', 'telefono'),
      direccion: optionalPattern(body.direccion, 'direccion', 'direccion'),
    },
    ApiError
  );
}

/** El cliente se edita a si mismo desde su perfil. */
export function selfRules(body) {
  return fichaRules(body);
}

/** Alta desde la administracion: ademas decide si la cuenta nace activa. */
export function createRules(body) {
  const data = fichaRules(body);

  if (body.password !== undefined && body.password !== '') {
    data.password = validatePattern(body.password, 'password', 'password').value;
  }

  return data;
}

/** Edicion desde la administracion: todo opcional, y puede cambiar la clave. */
export function updateRules(body) {
  const validator = {};

  const texto = (campo, patron) => {
    if (body[campo] !== undefined) {
      validator[campo] = validatePattern(body[campo], patron, campo);
    }
  };

  const opcional = (campo, patron) => {
    if (body[campo] !== undefined) {
      validator[campo] = optionalPattern(body[campo], patron, campo);
    }
  };

  texto('nombre', 'nombre');
  texto('documento', 'documento');
  texto('fechaNacimiento', 'date');
  texto('email', 'email');
  opcional('telefono', 'telefono');
  opcional('direccion', 'direccion');

  if (body.password !== undefined && body.password !== '') {
    validator.password = validatePattern(body.password, 'password', 'password');
  }

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