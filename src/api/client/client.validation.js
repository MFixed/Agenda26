import {
  optionalPattern,
  validateBool,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';

/**
 * Ficha del cliente. El email y la contrasena no estan aqui: viven en la cuenta
 * de usuario, y el rol y el estado de esa cuenta los decide la administracion,
 * no el formulario.
 *
 * v2 anade `notas`: el historial del cliente (alergias, preferencias, como le
 * gusta que le avisen) no cabia en `direccion` y se acababa escribiendo en el
 * campo equivocado.
 */
function fichaRules(body) {
  return validateOrThrow({
    nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
    documento: validatePattern(body.documento, 'documento', 'documento'),
    fechaNacimiento: validatePattern(body.fechaNacimiento, 'date', 'fechaNacimiento'),
    email: validatePattern(body.email, 'email', 'email'),
    telefono: optionalPattern(body.telefono, 'telefono', 'telefono'),
    direccion: optionalPattern(body.direccion, 'direccion', 'direccion'),
    notas: optionalPattern(body.notas, 'texto', 'notas'),
  });
}

/** El cliente se edita a si mismo desde su perfil. */
export function selfRules(body) {
  return fichaRules(body);
}

/** Alta desde la administracion: ademas decide si la cuenta nace activa. */
export function createRules(body) {
  const data = fichaRules(body);

  if (body.password !== undefined && body.password !== '') {
    /*
     * Se valida con `validateOrThrow` y no con `validatePattern(...).value`.
     *
     * Con el segundo, una contrasena invalida devuelve `{ valid: false }` SIN
     * `value`, y leer `.value` da `undefined`: el campo se cuela como si no
     * hubiera llegado y el service genera una temporal en silencio. El cliente
     * recibe un 201 con su "contrasena" y no se entera hasta que no puede entrar.
     */
    Object.assign(
      data,
      validateOrThrow({ password: validatePattern(body.password, 'password', 'password') })
    );
  }

  return data;
}

/**
 * Edicion desde la administracion: todo opcional, y puede cambiar la clave.
 *
 * `activo` desactiva la CUENTA (User), no la ficha: un cliente que no viene hace
 * un mes sigue existiendo, solo que no puede entrar.
 */
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
  opcional('notas', 'texto');

  if (body.password !== undefined && body.password !== '') {
    validator.password = validatePattern(body.password, 'password', 'password');
  }

  if (body.activo !== undefined) {
    validator.activo = validateBool(body.activo, 'activo');
  }

  return validatePatch(validator);
}

export default { selfRules, createRules, updateRules };
