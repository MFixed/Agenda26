/**
 * Paginacion de los listados. Todas las paginas del frontend piden paginas de
 * tamaño fijo y calculan el total para el paginador, asi que limit y offset
 * forman parte del contrato de casi todos los listados.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/**
 * Lee limit/offset de la query string. El tope existe para que un limit
 * desmedido no pueda traer la tabla entera de golpe.
 */
export function pagination(query = {}) {
  const limite = Number(query.limit);
  const offset = Number(query.offset);

  return {
    limit: Number.isFinite(limite) ? Math.min(Math.max(Math.trunc(limite), 1), MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0,
  };
}

/**
 * Busca el mismo texto en varios campos a la vez: "buscar por nombre,
 * documento…". Devuelve {} cuando no hay texto, para poder extenderse con
 * `...` sin condiciones.
 */
export function busquedaTexto(texto, campos) {
  const limpio = String(texto || '').trim();

  return limpio
    ? { OR: campos.map((campo) => ({ [campo]: { contains: limpio } })) }
    : {};
}