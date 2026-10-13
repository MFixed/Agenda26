import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginaPorCursor, codificarCursor, decodificarCursor, whereCursor } from '../src/utils/pagination.js';

/**
 * Paginacion por cursor.
 *
 * Lo que se comprueba aqui es la UNICA cosa que puede salir mal de esta funcion y
 * que es dificil de ver: el filtro del cursor y el filtro del llamante tienen que
 * cruzarse, no pisarse.
 *
 * El fallo: `whereCursor` devuelve `{ OR: [...] }`, y el llamante puede traer ya un
 * `OR` suyo (la busqueda por texto cruza nombre, notas y email). Con
 * `{ ...where, ...whereCursor() }` la segunda clave `OR` pisa a la primera y la
 * busqueda desaparece: desde la pagina 2 el listado devolvia TODOS los registros del
 * negocio ignorando el `?q`. No daba error, daba datos de mas.
 */

/**
 * Doble minimo de Prisma.
 *
 * `paginaPorCursor` llama a `prisma[modelo].findMany(...)`, asi que el doble
 * necesita esa forma: una propiedad por modelo, no un `findMany` en la raiz. Se
 * registra lo que se pide para poder comprobar como se cruzan los filtros.
 */
function doblePrisma(filas, modelo = 'thing') {
  const llamadas = [];

  const findMany = async (args) => {
    llamadas.push({ modelo, ...args });
    return typeof filas === 'function' ? filas(args) : filas;
  };

  return { llamadas, [modelo]: { findMany } };
}

/** Cursor bien formado, con la fecha como `Date` (que es lo que `codificarCursor` pide). */
const cursorDe = (id, fecha = '2026-03-01T10:00:00.000Z') =>
  codificarCursor({ id, createdAt: new Date(fecha) });

describe('whereCursor', () => {
  it('sin cursor no filtra nada', () => {
    assert.deepEqual(whereCursor(undefined), {});
    assert.deepEqual(whereCursor(''), {});
  });

  it('con un cursor invalido no filtra nada', () => {
    /// Un cursor corrupto no puede ser un 500 ni devolver la lista entera: se
    /// ignora y el paginador empieza desde el principio.
    assert.deepEqual(whereCursor('no-es-un-cursor'), {});
  });

  it('devuelve un OR sobre la columna de fecha y el id', () => {
    const filtro = whereCursor(cursorDe(7));

    assert.ok(Array.isArray(filtro.OR), 'debe devolver un OR');
    assert.equal(filtro.OR.length, 2, 'fecha anterior O misma fecha con id menor');
  });

  it('acepta la columna que se le indique', () => {
    /// Sin esto, quien ordena por una columna distinta recibe un filtro sobre
    /// `createdAt` y la paginacion salta filas o las repite.
    const filtro = whereCursor(cursorDe(7), 'updatedAt');

    const claves = JSON.stringify(filtro);
    assert.ok(claves.includes('updatedAt'), `debe filtrar por updatedAt, fue: ${claves}`);
    assert.ok(!claves.includes('createdAt'), `no debe filtrar por createdAt, fue: ${claves}`);
  });
});

describe('paginaPorCursor', () => {
  it('devuelve una pagina y un cursor para seguir', async () => {
    const prisma = doblePrisma([{ id: 1 }, { id: 2 }]);

    const resultado = await paginaPorCursor(prisma, 'thing', {}, { take: 2 });

    assert.equal(resultado.items.length, 2);
    assert.equal(resultado.hayMas, false, 'sin filas de sobra no hay mas paginas');
    assert.equal(resultado.siguienteCursor, null, 'sin mas, no hay cursor siguiente');
  });

  it('pide una fila de mas para saber si hay otra pagina', async () => {
    /// Pide `limite + 1` porque un COUNT en una tabla grande cuesta lo que el
    /// listado entero, y para saber "hay mas" basta con mirar si existe una fila mas.
    const prisma = doblePrisma([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const resultado = await paginaPorCursor(prisma, 'thing', {}, { take: 2 });

    assert.equal(prisma.llamadas[0].take, 3, 'debe pedir take + 1');
    assert.equal(resultado.items.length, 2, 'solo devuelve las 2 pedidas');
    assert.equal(resultado.hayMas, true, 'la fila de sobra indica que hay mas');
    assert.ok(resultado.siguienteCursor, 'con mas paginas debe dar cursor');
  });

  it('el cursor sale de la ULTIMA fila devuelta, no de la de sobra', async () => {
    const fecha = new Date('2026-03-01T10:00:00.000Z');
    const prisma = doblePrisma([
      { id: 1, createdAt: fecha },
      { id: 2, createdAt: fecha },
      { id: 3, createdAt: fecha },
    ]);

    const resultado = await paginaPorCursor(prisma, 'thing', {}, { take: 2 });
    const cursor = decodificarCursor(resultado.siguienteCursor);

    assert.equal(cursor.id, 2, 'el cursor debe ser el de la ultima fila ENTREGADA');
  });

  it('CRUZA el filtro del cursor con el del llamante, sin pisarse', async () => {
    /*
     * Este es EL test del archivo.
     *
     * El llamante trae su propio `OR` (la busqueda por texto). Si el paginador
     * hiciera `{ ...where, ...whereCursor() }`, ese `OR` desapareceria y la pagina
     * 2 devolveria registros que no coinciden con la busqueda. Con `AND`, los dos
     * filtros se evaluan juntos.
     */
    const prisma = doblePrisma([], 'cliente');

    await paginaPorCursor(
      prisma,
      'cliente',
      { businessId: 7, OR: [{ nombre: 'ana' }, { 'profile.notas': 'ana' }] },
      { cursor: cursorDe(3), take: 20 }
    );

    const where = prisma.llamadas[0].where;

    assert.ok(Array.isArray(where.AND), 'debe cruzar con AND');
    assert.equal(where.AND.length, 2, 'el filtro del llamante y el del cursor');

    const delLlamante = where.AND[0];
    const delCursor = where.AND[1];

    assert.ok(delLlamante.OR, 'el OR del llamante debe seguir intacto');
    assert.equal(delLlamante.businessId, 7, 'y su businessId tambien');
    assert.ok(delCursor.OR, 'el filtro del cursor va aparte');
  });

  it('el limite se recorta a un rango utilizable', async () => {
    const prisma = doblePrisma([]);

    await paginaPorCursor(prisma, 'thing', {}, { take: -5 });
    assert.ok(prisma.llamadas[0].take >= 2, 'un limite negativo da al menos take+1');

    await paginaPorCursor(prisma, 'thing', {}, { take: 999999 });
    assert.ok(prisma.llamadas[1].take <= 1001, 'un limite enorme se recorta a MAX_LIMIT');
  });

  it('un limite que no es un numero usa el de por defecto', async () => {
    const prisma = doblePrisma([]);

    await paginaPorCursor(prisma, 'thing', {}, { take: 'muchos' });
    assert.equal(prisma.llamadas[0].take, 51, 'debe caer en DEFAULT_LIMIT (50) + 1');
  });
});
