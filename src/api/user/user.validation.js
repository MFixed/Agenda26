import {
  optionalPattern,
  validateBool,
  validateOneOf,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';

export const ROLES_NEGOCIO = ['ADMIN', 'STAFF', 'CLIENT'];

/**
 * Gestion de cuentas de una empresa (nuevo en v2).
 *
 * v1 solo sabia crear el PRIMER administrador, al dar de alta la empresa con
 * `POST /super/negocios`. Despues no habia forma de anadir un segundo admin: una
 * empresa con una sola cuenta de administracion es un punto unico de fallo (si se
 * va la unica persona con la clave, la empresa se queda sin puerta).
 *
 * Esto es el hueco que se cierra.
 */
export function createRules(body) {
  const data = validateOrThrow({
    nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
    email: validatePattern(body.email, 'email', 'email'),
    /// Sin contrasena se genera una temporal (lo hace el service). Si viene, se
    /// valida de verdad: leer `.value` sin comprobar `valid` haria que una
    /// contrasena invalida se colara como `undefined`.
    ...(body.password ? { password: validatePattern(body.password, 'password', 'password') } : {}),
    role: validateOneOf(body.role ?? 'STAFF', ROLES_NEGOCIO, 'role'),
    telefono: optionalPattern(body.telefono, 'telefono', 'telefono'),
  });

  // Un STAFF con ficha de profesional puede engancharse a una que ya exista (por
  // ejemplo, el mismo profesional que ya atendia sin tener cuenta).
  if (data.role === 'STAFF' && body.staffId !== undefined) {
    data.staffId = Number(body.staffId);
  }

  return data;
}

export function updateRules(body) {
  return validatePatch({
    nombre: body.nombre === undefined ? undefined : validatePattern(body.nombre, 'nombre', 'nombre'),
    email: body.email === undefined ? undefined : validatePattern(body.email, 'email', 'email'),
    password:
      body.password === undefined ? undefined : validatePattern(body.password, 'password', 'password'),
    role: body.role === undefined ? undefined : validateOneOf(body.role, ROLES_NEGOCIO, 'role'),
    telefono:
      body.telefono === undefined ? undefined : optionalPattern(body.telefono, 'telefono', 'telefono'),
    /*
     * `validateBool` y no `{ valid: true, value: !!body.activo }`.
     *
     * Con `!!`, el string `"false"` (que llega asi desde una query string o desde un
     * formulario) se convierte en `true`: desactivar una cuenta la activaba. El
     * validador distingue `"false"` de `false` justamente para eso.
     */
    activo: body.activo === undefined ? undefined : validateBool(body.activo, 'activo'),
  });
}

export default { ROLES_NEGOCIO, createRules, updateRules };
