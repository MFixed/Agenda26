import {
  optionalInt,
  optionalPattern,
  validateOrThrow,
  validatePattern
} from '../../utils/regexValidator.js';
import { ApiError } from '../../utils/errorHandler.js';

export const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/**
 * Vistas de la lista de tareas. El alcance decide de quien son; el filtro, en
 * que estado o con que fecha.
 */
export const ALCANCES = ['propias', 'de-citas'];
export const FILTROS = ['pendientes', 'completadas', 'sin-fecha', 'agendadas'];

function statusValidator(value) {
  if (!STATUSES.includes(value)) {
    return { valid: false, message: `status debe ser uno de: ${STATUSES.join(', ')}` };
  }

  return { valid: true, value };
}

export function createRules(body) {
  return validateOrThrow(
    {
      title: validatePattern(body.title, 'titulo', 'title'),
      description: optionalPattern(body.description, 'texto', 'description'),
      categoryId: optionalInt(body.categoryId, 'categoryId'),
      clientId: optionalInt(body.clientId, 'clientId'),
      // Enviar el campo vacio significa NULL, que es la vista "sin fecha".
      dueDate: optionalPattern(body.dueDate, 'date', 'dueDate'),
      dueTime: optionalPattern(body.dueTime, 'time', 'dueTime'),
      status: body.status === undefined ? { valid: true, value: 'PENDING' } : statusValidator(body.status),
    },
    ApiError
  );
}

export function updateRules(body) {
  const validator = {};

  if (body.title !== undefined) {
    validator.title = validatePattern(body.title, 'titulo', 'title');
  }

  if (body.description !== undefined) {
    validator.description = optionalPattern(body.description, 'texto', 'description');
  }

  if (body.categoryId !== undefined) {
    validator.categoryId = optionalInt(body.categoryId, 'categoryId');
  }

  if (body.clientId !== undefined) {
    validator.clientId = optionalInt(body.clientId, 'clientId');
  }

  if (body.dueDate !== undefined) {
    validator.dueDate = optionalPattern(body.dueDate, 'date', 'dueDate');
  }

  if (body.dueTime !== undefined) {
    validator.dueTime = optionalPattern(body.dueTime, 'time', 'dueTime');
  }

  if (body.status !== undefined) {
    validator.status = statusValidator(body.status);
  }

  if (Object.keys(validator).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  return validateOrThrow(validator, ApiError);
}

export function listFilters(query) {
  const filtros = {};

  const unoDe = (valor, lista, campo) => {
    if (!valor) {
      return;
    }
    if (!lista.includes(valor)) {
      throw ApiError.badRequest(`${campo} debe ser uno de: ${lista.join(', ')}`);
    }
  };

  unoDe(query.estado, STATUSES, 'estado');
  unoDe(query.alcance, ALCANCES, 'alcance');
  unoDe(query.filtro, FILTROS, 'filtro');

  return {
    ...(query.estado ? { estado: query.estado } : {}),
    ...(query.alcance ? { alcance: query.alcance } : {}),
    ...(query.filtro ? { filtro: query.filtro } : {}),
    ...(query.categoryId ? { categoryId: Number(query.categoryId) } : {}),
    ...(query.clientId ? { clientId: Number(query.clientId) } : {}),
    ...(query.desde ? { desde: query.desde } : {}),
    ...(query.hasta ? { hasta: query.hasta } : {}),
    ...(query.q ? { q: String(query.q).trim() } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.offset !== undefined ? { offset: query.offset } : {}),
  };
}