import {
  optionalPattern,
  validateBool,
  validateInt,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Alta de negocio desde el panel de la plataforma.
 *
 * El negocio y su primer administrador se crean juntos porque una empresa sin
 * nadie que la administre no tiene ninguna puerta abierta.
 *
 * v2 anade la zona horaria. Sin ella, el "hoy" de la agenda se calculaba con la
 * zona del SERVIDOR: una clinica en Montevideo veia el dia equivocado a partir de
 * las 21:00. Ahora la lleva puesta desde que nace.
 */
export function createRules(body) {
  return validateOrThrow({
    nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
    slug: validatePattern(body.slug, 'slug', 'slug'),
    descripcion: optionalPattern(body.descripcion, 'direccion', 'descripcion'),
    timezone: body.timezone
      ? validatePattern(body.timezone, 'timezone', 'timezone')
      : { valid: true, value: 'UTC' },
    bufferMin: validateInt(body.bufferMin ?? 0, 'bufferMin', { min: 0, max: 240 }),
    slotMinutes: validateInt(body.slotMinutes ?? 60, 'slotMinutes', { min: 5, max: 480 }),
    adminNombre: validatePattern(body.adminNombre, 'nombre', 'adminNombre'),
    adminEmail: validatePattern(body.adminEmail, 'email', 'adminEmail'),
    adminPassword: validatePattern(body.adminPassword, 'password', 'adminPassword'),
  });
}

export function updateRules(body) {
  const validator = {};

  if (body.nombre !== undefined) validator.nombre = validatePattern(body.nombre, 'nombre', 'nombre');
  if (body.descripcion !== undefined)
    validator.descripcion = optionalPattern(body.descripcion, 'direccion', 'descripcion');
  if (body.activo !== undefined) validator.activo = validateBool(body.activo, 'activo');
  if (body.bufferMin !== undefined)
    validator.bufferMin = validateInt(body.bufferMin, 'bufferMin', { min: 0, max: 240 });
  if (body.slotMinutes !== undefined)
    validator.slotMinutes = validateInt(body.slotMinutes, 'slotMinutes', { min: 5, max: 480 });

  if (body.timezone !== undefined) {
    validator.timezone = validatePattern(body.timezone, 'timezone', 'timezone');
  }

  /*
   * El `slug` NO se puede cambiar.
   *
   * Es la direccion publica de la empresa (/b/:slug/login). Si cambiara, todos los
   * enlaces ya repartidos dejarian de funcionar sin aviso, y la empresa perderia la
   * puerta que sus clientes usan para entrar.
   *
   * Se responde con un error EXPLICITO y no con un "campo ignorado": si el frontend
   * manda el slug y recibe un 200 sin que nada haya cambiado, el aviso le llega
   * semanas despues, cuando un enlace viejo deja de abrir. Un 400 aqui es el unico
   * momento en que se puede decir.
   */
  if (body.slug !== undefined) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'slug', message: 'El identificador no se puede cambiar: forma parte de la direccion publica' },
    ]);
  }

  if (Object.keys(validator).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  return validateOrThrow(validator);
}

export function settingsRules(body) {
  return validatePatch({
    holdMinutes:
      body.holdMinutes === undefined
        ? undefined
        : validateInt(body.holdMinutes, 'holdMinutes', { min: 1, max: 120 }),
    reminderBeforeMin:
      body.reminderBeforeMin === undefined
        ? undefined
        : validateInt(body.reminderBeforeMin, 'reminderBeforeMin', { min: 0, max: 43_200 }),
    remindersEnabled:
      body.remindersEnabled === undefined
        ? undefined
        : validateBool(body.remindersEnabled, 'remindersEnabled'),
    emailEnabled:
      body.emailEnabled === undefined ? undefined : validateBool(body.emailEnabled, 'emailEnabled'),
    whatsappEnabled:
      body.whatsappEnabled === undefined ? undefined : validateBool(body.whatsappEnabled, 'whatsappEnabled'),
  });
}

export default { createRules, updateRules, settingsRules };
