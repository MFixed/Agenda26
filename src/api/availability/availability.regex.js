import {
  optionalPattern,
  validateOrThrow,
  validatePattern
} from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

export const STATUSES = ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'];

function statusValidator(value, fieldName = 'status') {
  if (!STATUSES.includes(value)) {
    return { valid: false, message: `${fieldName} debe ser uno de: ${STATUSES.join(', ')}` };
  }

  return { valid: true, value };
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
  const data = validateOrThrow(
    {
      ...franjaRules(body),
      status: body.status === undefined
        ? { valid: true, value: 'AVAILABLE' }
        : statusValidator(body.status),
      note: optionalPattern(body.note, 'nombre', 'note'),
    },
    ApiError
  );

  assertFranjaValida(data);

  return data;
}

export function updateRules(body) {
  const validator = {};

  if (body.date !== undefined) {
    validator.date = validatePattern(body.date, 'date', 'date');
  }

  if (body.startTime !== undefined) {
    validator.startTime = validatePattern(body.startTime, 'time', 'startTime');
  }

  if (body.endTime !== undefined) {
    validator.endTime = validatePattern(body.endTime, 'time', 'endTime');
  }

  if (body.status !== undefined) {
    validator.status = statusValidator(body.status);
  }

  if (body.note !== undefined) {
    validator.note = optionalPattern(body.note, 'nombre', 'note');
  }

  if (Object.keys(validator).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  const data = validateOrThrow(validator, ApiError);

  // Solo se comprueba la coherencia de la franja si el envio viene entero o
  // completa: una edicion suelta se valida contra el horario ya guardado.
  if (data.startTime !== undefined && data.endTime !== undefined) {
    assertFranjaValida(data);
  }

  return data;
}