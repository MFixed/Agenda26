import {
  optionalInt,
  optionalPattern,
  validateOneOf,
  validateOrThrow,
  validatePatch,
  validatePattern,
} from '../../utils/validation.js';

export const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/**
 * Vistas de la lista de tareas. El alcance decide de quien son; el filtro, en que
 * estado o con que fecha.
 */
export const ALCANCES = ['propias', 'de-citas'];
export const FILTROS = ['pendientes', 'completadas', 'sin-fecha', 'agendadas', 'vencidas'];

function statusValidator(value) {
  return validateOneOf(value, STATUSES, 'status');
}

export function createRules(body) {
  return validateOrThrow({
    title: validatePattern(body.title, 'titulo', 'title'),
    description: optionalPattern(body.description, 'texto', 'description'),
    categoryId: optionalInt(body.categoryId, 'categoryId'),
    clientId: optionalInt(body.clientId, 'clientId'),
    /// Enviar el campo vacio significa NULL, que es la vista "sin fecha".
    dueDate: optionalPattern(body.dueDate, 'date', 'dueDate'),
    dueTime: optionalPattern(body.dueTime, 'time', 'dueTime'),
    status: body.status === undefined ? { valid: true, value: 'PENDING' } : statusValidator(body.status),
  });
}

export function updateRules(body) {
  const validator = {};

  if (body.title !== undefined) validator.title = validatePattern(body.title, 'titulo', 'title');
  if (body.description !== undefined)
    validator.description = optionalPattern(body.description, 'texto', 'description');
  if (body.categoryId !== undefined) validator.categoryId = optionalInt(body.categoryId, 'categoryId');
  if (body.clientId !== undefined) validator.clientId = optionalInt(body.clientId, 'clientId');
  if (body.dueDate !== undefined) validator.dueDate = optionalPattern(body.dueDate, 'date', 'dueDate');
  if (body.dueTime !== undefined) validator.dueTime = optionalPattern(body.dueTime, 'time', 'dueTime');
  if (body.status !== undefined) validator.status = statusValidator(body.status);

  return validatePatch(validator);
}

export function listFilters(query) {
  const filtros = {};

  if (query.estado) filtros.estado = validateOneOf(query.estado, STATUSES, 'estado').value;
  if (query.alcance) filtros.alcance = validateOneOf(query.alcance, ALCANCES, 'alcance').value;
  if (query.filtro) filtros.filtro = validateOneOf(query.filtro, FILTROS, 'filtro').value;

  if (query.categoryId) filtros.categoryId = Number(query.categoryId);
  if (query.clientId) filtros.clientId = Number(query.clientId);
  if (query.desde) filtros.desde = query.desde;
  if (query.hasta) filtros.hasta = query.hasta;
  if (query.q) filtros.q = String(query.q).trim();

  if (query.limit !== undefined) filtros.limit = query.limit;
  if (query.offset !== undefined) filtros.offset = query.offset;

  return filtros;
}

export default { STATUSES, ALCANCES, FILTROS, createRules, updateRules, listFilters };
