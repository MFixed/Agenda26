import {
  optionalPattern,
  validateInt,
  validateOneOf,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';
import { ApiError } from '../../utils/ApiError.js';

export const STATUSES = ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'];

function statusValidator(value, fieldName = 'status') {
  return validateOneOf(value, STATUSES, fieldName);
}

/** Los tiempos son 'HH:MM', comparables como texto sin convertir a Date. */
function franjaRules(body) {
  return {
    date: validatePattern(body.date, 'date', 'date'),
    startTime: validatePattern(body.startTime, 'time', 'startTime'),
    endTime: validatePattern(body.endTime, 'time', 'endTime'),
  };
}

function assertFranjaValida({ startTime, endTime }) {
  if (startTime >= endTime) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'startTime', message: 'La hora de inicio debe ser anterior a la de fin' },
    ]);
  }
}

export function createRules(body) {
  const data = validateOrThrow({
    ...franjaRules(body),
    status: body.status === undefined ? { valid: true, value: 'AVAILABLE' } : statusValidator(body.status),
    staffId: validateInt(body.staffId, 'staffId', { optional: true }),
    note: optionalPattern(body.note, 'nombre', 'note'),
  });

  assertFranjaValida(data);

  return data;
}

export function updateRules(body) {
  const validator = {};

  if (body.date !== undefined) validator.date = validatePattern(body.date, 'date', 'date');
  if (body.startTime !== undefined)
    validator.startTime = validatePattern(body.startTime, 'time', 'startTime');
  if (body.endTime !== undefined) validator.endTime = validatePattern(body.endTime, 'time', 'endTime');
  if (body.status !== undefined) validator.status = statusValidator(body.status);
  if (body.staffId !== undefined)
    validator.staffId = validateInt(body.staffId, 'staffId', { optional: true });
  if (body.note !== undefined) validator.note = optionalPattern(body.note, 'nombre', 'note');

  const data = validatePatch(validator);

  /// Solo se comprueba la coherencia de la franja si el envio viene entero o
  /// completo: una edicion suelta se valida contra el horario ya guardado.
  if (data.startTime !== undefined && data.endTime !== undefined) {
    assertFranjaValida(data);
  }

  return data;
}

/**
 * Un id de la query se convierte con `validateInt`, no con `Number(...)`.
 *
 * `Number('abc')` da `NaN`, que es *falsy*: el filtro quedaba como `NaN` y el
 * `filtros.staffId ? ...` de despues lo leia como "no hay filtro". En vez de un
 * 400 con un mensaje util, se devolvian los huecos de todos los profesionales.
 */
function staffIdDeQuery(query) {
  if (query.staffId === undefined || query.staffId === '') {
    return null;
  }

  const resultado = validateInt(query.staffId, 'staffId', { min: 1 });

  if (!resultado.valid) {
    throw ApiError.badRequest(resultado.message);
  }

  return resultado.value;
}

export function listFilters(query, role) {
  const filtros = {};

  if (role === 'CLIENT') {
    /// El cliente solo ve lo que puede reservar y solo hacia adelante: un hueco ya
    /// pasado no sirve para nada y uno reservado no debe lacear a otros.
    return {
      estado: 'AVAILABLE',
      desde: query.desde || null,
      hasta: query.hasta,
      staffId: staffIdDeQuery(query),
      limit: query.limit,
      offset: query.offset,
    };
  }

  if (query.estado) filtros.estado = validateOneOf(query.estado, STATUSES, 'estado').value;
  if (query.desde) filtros.desde = query.desde;
  if (query.hasta) filtros.hasta = query.hasta;
  if (query.staffId) filtros.staffId = staffIdDeQuery(query);

  if (query.limit !== undefined) filtros.limit = query.limit;
  if (query.offset !== undefined) filtros.offset = query.offset;

  return filtros;
}

export default { STATUSES, createRules, updateRules, listFilters };
