import {
  optionalPattern,
  validateBool,
  validateInt,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';

export function createRules(body) {
  return validateOrThrow({
    nombre: validatePattern(body.nombre, 'nombre', 'nombre'),
    email: optionalPattern(body.email, 'email', 'email'),
    telefono: optionalPattern(body.telefono, 'telefono', 'telefono'),
    especialidad: optionalPattern(body.especialidad, 'nombre', 'especialidad'),
    color: optionalPattern(body.color, 'hex', 'color'),
    activo: validateBool(body.activo ?? true, 'activo'),
  });
}

export function updateRules(body) {
  return validatePatch({
    nombre: body.nombre === undefined ? undefined : validatePattern(body.nombre, 'nombre', 'nombre'),
    email: body.email === undefined ? undefined : optionalPattern(body.email, 'email', 'email'),
    telefono:
      body.telefono === undefined ? undefined : optionalPattern(body.telefono, 'telefono', 'telefono'),
    especialidad:
      body.especialidad === undefined
        ? undefined
        : optionalPattern(body.especialidad, 'nombre', 'especialidad'),
    color: body.color === undefined ? undefined : optionalPattern(body.color, 'hex', 'color'),
    activo: body.activo === undefined ? undefined : validateBool(body.activo, 'activo'),
  });
}

/**
 * Agenda recurrente (nuevo en v2): "los lunes de 09:00 a 18:00, bloques de 60".
 *
 * v1 obligaba a publicar cada bloque a mano. Una semana normal de una clinica son
 * ~40 peticiones, y el domingo por la noche es exactamente cuando nadie quiere
 * estar haciendo eso.
 */
export function scheduleRules(body) {
  return validateOrThrow({
    weekday: validateInt(body.weekday, 'weekday', { min: 0, max: 6 }),
    startTime: validatePattern(body.startTime, 'time', 'startTime'),
    endTime: validatePattern(body.endTime, 'time', 'endTime'),
    slotMinutes: validateInt(body.slotMinutes ?? 60, 'slotMinutes', { min: 5, max: 480 }),
    staffId: validateInt(body.staffId, 'staffId', { optional: true }),
    note: optionalPattern(body.note, 'nombre', 'note'),
    activo: validateBool(body.activo ?? true, 'activo'),
  });
}

export function scheduleUpdateRules(body) {
  return validatePatch({
    weekday:
      body.weekday === undefined ? undefined : validateInt(body.weekday, 'weekday', { min: 0, max: 6 }),
    startTime:
      body.startTime === undefined ? undefined : validatePattern(body.startTime, 'time', 'startTime'),
    endTime: body.endTime === undefined ? undefined : validatePattern(body.endTime, 'time', 'endTime'),
    slotMinutes:
      body.slotMinutes === undefined
        ? undefined
        : validateInt(body.slotMinutes, 'slotMinutes', { min: 5, max: 480 }),
    staffId:
      body.staffId === undefined ? undefined : validateInt(body.staffId, 'staffId', { optional: true }),
    note: body.note === undefined ? undefined : optionalPattern(body.note, 'nombre', 'note'),
    activo: body.activo === undefined ? undefined : validateBool(body.activo, 'activo'),
  });
}

/** Generar bloques a partir de la plantilla para un rango de fechas. */
export function generateRules(body) {
  return validateOrThrow({
    desde: validatePattern(body.desde, 'date', 'desde'),
    hasta: validatePattern(body.hasta, 'date', 'hasta'),
    /// Los dias de la semana a materializar. Vacio = todos los que tengan
    /// plantilla.
    dias: body.dias ? { valid: true, value: body.dias.map((d) => Number(d)) } : { valid: true, value: [] },
    /// Sobrescribir la duracion por bloque en esta generacion puntual.
    slotMinutes:
      body.slotMinutes === undefined
        ? { valid: true, value: null }
        : validateInt(body.slotMinutes, 'slotMinutes', { min: 5, max: 480 }),
    /// Si viene, los bloques se crean para este profesional en vez de para la
    /// empresa entera.
    staffId: validateInt(body.staffId, 'staffId', { optional: true }),
  });
}

export function waitlistRules(body) {
  return validateOrThrow({
    clientId: validateInt(body.clientId, 'clientId'),
    categoryId: validateInt(body.categoryId, 'categoryId', { optional: true }),
    staffId: validateInt(body.staffId, 'staffId', { optional: true }),
    dateFrom: validatePattern(body.dateFrom, 'date', 'dateFrom'),
    dateTo: body.dateTo ? validatePattern(body.dateTo, 'date', 'dateTo') : { valid: true, value: null },
    note: optionalPattern(body.note, 'nota', 'note'),
  });
}

export default {
  createRules,
  updateRules,
  scheduleRules,
  scheduleUpdateRules,
  generateRules,
  waitlistRules,
};
