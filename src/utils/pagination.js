/**
 * Paginacion.
 *
 * v2 anade paginacion por cursor al lado de la clasica por offset.
 *
 * Offset (`?limit=&offset=`) es comodo pero se degrada: `OFFSET 50000` obliga a
 * leer y descartar 50000 filas. Con una cartera de clientes grande, la pagina
 * 500 tarda lo mismo que la primera. El cursor resuelve las dos cosas: pagina
 * en tiempo constante y no puede perder filas ni repetirlas cuando alguien
 * inserta entre pagina y pagina.
 *
 * Se ofrecen las dos porque el frontend ya pide paginas numeradas (necesita el
 * total para pintar "pagina 3 de 12"), y ahi el offset es lo que hay. El cursor
 * es para quien recorra listados largos:/exportaciones.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/**
 * Lee limit/offset de la query string.
 *
 * El tope existe para que un limit desmedido no pueda traer la tabla entera de
 * golpe. Math.min antes que un throw: un limit enorme es un cliente que quiere
 * muchos datos, no un cliente que quiere romper el servidor.
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
 * Busca el mismo texto en varios campos a la vez.
 *
 * Devuelve {} cuando no hay texto, para poder extenderse con `...` sin meter una
 * condicion que no vale.
 *
 * `contains` se traduce a `LIKE '%texto%'`, que es un recorrido de tabla: no hay
 * indice que lo accelerate, porque los indices B-tree no sirven para comodines al
 * principio. En SQLite tampoco hay trigram (eso era `pg_trgm` de PostgreSQL).
 *
 * Con la base de desarrollo va bien. Si algun dia hay que buscar entre miles de
 * filas y se nota, la solucion es FTS5: una tabla virtual de indice inverso que
 * SQLite trae de serie y que responde en milisegundos. Se anadiria en la migracion
 * junto con sus disparadores.
 */
export function busquedaTexto(texto, campos) {
  const limpio = String(texto || '').trim();

  return limpio ? { OR: campos.map((campo) => ({ [campo]: { contains: limpio } })) } : {};
}

/**
 * CURSOR: Codifica `id` + `createdAt` en base64url.
 *
 * El `createdAt` va dentro porque casi todos los listados se ordenan por fecha y
 * un cursor solo con `id` daria resultados incoherentes si dos filas comparten
 * fecha (que es lo normal: un alta en lote comparte milisegundo).
 *
 * base64url y no base64: son caracteres validos en una query string sin tener
 * que escaparlos, que es lo que un base64 normal obliga a escribir en el
 * `encodeURIComponent` de cada lado.
 */
export function codificarCursor(registro) {
  if (!registro) return null;

  const payload = { id: registro.id, f: registro.createdAt?.toISOString?.() ?? null };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodificarCursor(cursor) {
  if (!cursor) return null;

  try {
    const payload = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));

    if (typeof payload?.id !== 'number') return null;

    return {
      id: payload.id,
      createdAt: payload.f ? new Date(payload.f) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Devuelve el where de Prisma para un cursor, sobre un orden `createdAt desc`.
 *
 * Busca las filas MAS NUEVAS que la del cursor: `createdAt` menor que el de la
 * ultima fila entregada, o igual con id menor (para desempatar).
 */
export function whereCursor(cursor, campoFecha = 'createdAt') {
  const punto = decodificarCursor(cursor);

  if (!punto) return {};

  if (!punto.createdAt) return { id: { lt: punto.id } };

  return {
    OR: [{ [campoFecha]: { lt: punto.createdAt } }, { [campoFecha]: punto.createdAt, id: { lt: punto.id } }],
  };
}

/**
 * Envoltura de una consulta paginada por cursor.
 *
 * Pide limit+1 filas para saber si hay mas sin un COUNT: el total exacto de una
 * tabla grande cuesta lo que cuesta el listado entero, y para "hay mas" sobra
 * con saber si la siguiente fila existe.
 */
export async function paginaPorCursor(
  prisma,
  modelo,
  where,
  {
    cursor,
    take = DEFAULT_LIMIT,
    orderBy = [{ createdAt: 'desc' }, { id: 'desc' }],
    include,
    campoCursor = 'createdAt',
  } = {}
) {
  const limite = Math.min(Math.max(Number(take) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  /*
   * El filtro del cursor se CRUZA con el del llamante, no se le echa encima.
   *
   * `whereCursor` devuelve `{ OR: [...] }` y el `where` del llamante tambien
   * puede traer un `OR` (es el caso de la busqueda por texto, que mira nombre,
   * notas y email). Con `{ ...where, ...whereCursor() }` la segunda clave `OR`
   * pisa a la primera y el filtro de busqueda desaparece: desde la pagina 2 el
   * listado devolvia TODOS los registros del negocio ignorando el `?q`.
   *
   * Con `AND`, las dos condiciones se evaluan juntas, que es lo que se quiere: la
   * busqueda de antes Y "estas despues del cursor".
   */
  const filas = await prisma[modelo].findMany({
    where: { AND: [where, whereCursor(cursor, campoCursor)] },
    orderBy,
    take: limite + 1,
    ...(include ? { include } : {}),
  });

  const hayMas = filas.length > limite;
  const items = hayMas ? filas.slice(0, limite) : filas;

  return {
    items,
    hayMas,
    siguienteCursor: hayMas ? codificarCursor(items[items.length - 1]) : null,
  };
}

export default {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  pagination,
  busquedaTexto,
  codificarCursor,
  decodificarCursor,
  whereCursor,
  paginaPorCursor,
};
