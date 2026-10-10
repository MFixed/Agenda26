import {
  optionalInt,
  optionalPattern,
  validateInt,
  validateOrThrow
} from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

export const STATUSES = ['PENDING', 'COORDINATED', 'COMPLETED', 'CANCELLED', 'REJECTED'];

/**
 * Transiciones validas. PENDING es la reserva inicial; COORDINATED confirma el
 * acuerdo; COMPLETED cierra el trabajo; CANCELLED y REJECTED son finales.
 */
export const TRANSITIONS = {
  PENDING: ['COORDINATED', 'CANCELLED', 'REJECTED'],
  COORDINATED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** Estados en los que la cita sigue ocupando el horario. */
const OCUPAN = ['PENDING', 'COORDINATED'];

/**
 * Al crear una cita la administracion puede dejarla pendiente (lo normal: el
 * cliente la pidio y espera respuesta) o darla ya por coordinada.
 */
export function createRules(body) {
  const status = body.status === undefined ? 'PENDING' : body.status;

  if (!['PENDING', 'COORDINATED'].includes(status)) {
    throw ApiError.badRequest('Una cita nueva solo puede empezar PENDING o COORDINATED');
  }

  return validateOrThrow(
    {
      availabilityId: validateInt(body.availabilityId, 'availabilityId'),
      // El CLIENT se identifica solo; el staff puede reservar en nombre de otro.
      clientId: optionalInt(body.clientId, 'clientId'),
      categoryId: optionalInt(body.categoryId, 'categoryId'),
      title: optionalPattern(body.title, 'titulo', 'title'),
      note: optionalPattern(body.note, 'texto', 'note'),
      status: { valid: true, value: status },
    },
    ApiError
  );
}

/** Edicion de una cita: moverla de horario o anotar algo. */
export function updateRules(body) {
  const validator = {};

  if (body.availabilityId !== undefined) {
    validator.availabilityId = validateInt(body.availabilityId, 'availabilityId');
  }

  if (body.note !== undefined) {
    validator.note = optionalPattern(body.note, 'texto', 'note');
  }

  if (Object.keys(validator).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  return validateOrThrow(validator, ApiError);
}

export function listFilters(query) {
  const filtros = {};

  if (query.estado) {
    if (!STATUSES.includes(query.estado)) {
      throw ApiError.badRequest(`estado debe ser uno de: ${STATUSES.join(', ')}`);
    }
    filtros.estado = query.estado;
  }

  if (query.clientId) {
    filtros.clientId = Number(query.clientId);
  }

  if (query.desde) {
    filtros.desde = query.desde;
  }

  if (query.hasta) {
    filtros.hasta = query.hasta;
  }

  if (query.q) {
    filtros.q = String(query.q).trim();
  }

  if (query.limit !== undefined) {
    filtros.limit = query.limit;
  }

  if (query.offset !== undefined) {
    filtros.offset = query.offset;
  }

  return filtros;
}

/**
 * Un estado por endpoint en vez de un PATCH con { status }: asi cada accion del
 * frontend es una ruta con su propio permiso y no se puede llegar a ellas por
 * error con un estado mal escrito. Quien puede invocarla lo decide el router.
 */
export const ESTADO_POR_ACCION = {
  coordinar: 'COORDINATED',
  completar: 'COMPLETED',
  rechazar: 'REJECTED',
  'cancelar-admin': 'CANCELLED',
  cancelar: 'CANCELLED',
};

export { OCUPAN };