import {
  optionalInt,
  optionalPattern,
  validateInt,
  validateOneOf,
  validateOrThrow,
  validatePatch,
} from '../../utils/validation.js';
import { ApiError } from '../../utils/ApiError.js';

export const STATUSES = ['PENDING', 'COORDINATED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW'];

/**
 * Transiciones validas. PENDING es la reserva inicial; COORDINATED confirma el
 * acuerdo; COMPLETED y NO_SHOW cierran el trabajo ya realizado; CANCELLED y
 * REJECTED son finales sin cita realizada.
 *
 * v2 anade NO_SHOW: "no se presento" es distinto de "cancelo" y no cabia en el
 * modelo. Mezclarlos hacia que las metricas de ausencias dieran 0 siempre, porque
 * todo se guardaba como CANCELLED.
 */
export const TRANSITIONS = {
  PENDING: ['COORDINATED', 'CANCELLED', 'REJECTED'],
  COORDINATED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
  NO_SHOW: [],
};

/** Estados en los que la cita sigue ocupando el horario. */
const OCUPAN = ['PENDING', 'COORDINATED'];

export function createRules(body) {
  const status = body.status === undefined ? 'PENDING' : body.status;

  if (!['PENDING', 'COORDINATED'].includes(status)) {
    throw ApiError.badRequest('Una cita nueva solo puede empezar PENDING o COORDINATED');
  }

  return validateOrThrow({
    availabilityId: validateInt(body.availabilityId, 'availabilityId'),
    /// El CLIENT se identifica solo; el staff puede reservar en nombre de otro.
    clientId: optionalInt(body.clientId, 'clientId'),
    categoryId: optionalInt(body.categoryId, 'categoryId'),
    staffId: optionalInt(body.staffId, 'staffId'),
    title: optionalPattern(body.title, 'titulo', 'title'),
    note: optionalPattern(body.note, 'texto', 'note'),
    status: { valid: true, value: status },
  });
}

export function updateRules(body) {
  return validatePatch({
    availabilityId:
      body.availabilityId === undefined ? undefined : validateInt(body.availabilityId, 'availabilityId'),
    staffId:
      body.staffId === undefined ? undefined : validateInt(body.staffId, 'staffId', { optional: true }),
    note: body.note === undefined ? undefined : optionalPattern(body.note, 'texto', 'note'),
    /// Version optimista. Si el cliente la manda y no coincide con la de la base,
    /// alguien edito la cita entre medio y se rechaza en vez de pisarlo.
    version: body.version === undefined ? undefined : validateInt(body.version, 'version', { min: 0 }),
  });
}

export function actionRules(body) {
  return validateOrThrow({
    note: optionalPattern(body?.note, 'nota', 'note'),
    cancelReason: optionalPattern(body?.cancelReason, 'nota', 'cancelReason'),
    /// Motivo de la ausencia. Separado de `note` porque de este campo salen las
    /// metricas ("el 30% no se presenta por distancia"), y mezclarlo con una nota
    /// libre haria el dato inservible.
    noShowReason: optionalPattern(body?.noShowReason, 'nota', 'noShowReason'),
  });
}

/**
 * Un id de la query se convierte con `validateInt`, no con `Number(...)`.
 *
 * `Number('abc')` es `NaN`, que es *falsy*: el filtro se construia como
 * `filtros.staffId = NaN` y luego `filtros.staffId ? ... : ...` lo tomaba por
 * "no filtrado". El resultado era el peor de los dos: en vez de un 400 diciendo
 * que el filtro no es valido, se devolvian los huecos de TODOS los profesionales.
 *
 * `validateInt` devuelve `{ valid, value }`, asi que un id roto sale con un 400
 * que si se puede entender, y un id bien escrito sale con su numero.
 */
function idDeQuery(query, clave) {
  if (query[clave] === undefined || query[clave] === '') {
    return undefined;
  }

  return validateInt(query[clave], clave, { min: 1 });
}

export function listFilters(query) {
  const filtros = {};

  if (query.estado) {
    const estado = validateOneOf(query.estado, STATUSES, 'estado');
    if (!estado.valid) throw ApiError.badRequest(estado.message);
    filtros.estado = estado.value;
  }

  for (const clave of ['clientId', 'staffId', 'categoryId']) {
    const resultado = idDeQuery(query, clave);
    if (resultado === undefined) continue;
    if (!resultado.valid) throw ApiError.badRequest(resultado.message);
    filtros[clave] = resultado.value;
  }

  if (query.desde) filtros.desde = query.desde;
  if (query.hasta) filtros.hasta = query.hasta;
  if (query.q) filtros.q = String(query.q).trim();

  if (query.limit !== undefined) filtros.limit = query.limit;
  if (query.offset !== undefined) filtros.offset = query.offset;

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
  'no-show': 'NO_SHOW',
};

export { OCUPAN };
