import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pagination,
  busquedaTexto,
  codificarCursor,
  decodificarCursor,
  whereCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../src/utils/pagination.js';

/**
 * Paginacion.
 *
 * Lo que se prueba aqui es que un `?limit=` desmedido de quien llame no pueda
 * traer la tabla entera de golpe, y que el cursor no rompa al paginar.
 */

describe('pagination', () => {
  it('pone un limite por defecto cuando no le pasan nada', () => {
    assert.deepEqual(pagination({}), { limit: DEFAULT_LIMIT, offset: 0 });
    assert.deepEqual(pagination(), { limit: DEFAULT_LIMIT, offset: 0 });
  });

  it('acepta limit y offset numericos como texto (query string)', () => {
    assert.deepEqual(pagination({ limit: '10', offset: '20' }), { limit: 10, offset: 20 });
  });

  it('acota el limite maximo', () => {
    /// La razon de existir del `Math.min`: un limit de un millon desde un curl no
    /// se rechaza con un error, se recorta. Quien lo pide quiere muchos datos, no
    /// tirar el servidor.
    assert.equal(pagination({ limit: 1_000_000 }).limit, MAX_LIMIT);
  });

  it('un limite de 0 o negativo sube a 1, no baja de 1', () => {
    assert.equal(pagination({ limit: 0 }).limit, 1);
    assert.equal(pagination({ limit: -5 }).limit, 1);
  });

  it('un offset negativo se queda en 0', () => {
    assert.equal(pagination({ offset: -100 }).offset, 0);
  });

  it('trunca los decimales', () => {
    assert.equal(pagination({ limit: '10.9' }).limit, 10);
    assert.equal(pagination({ offset: '5.9' }).offset, 5);
  });

  it('lo que no es numero usa los valores por defecto', () => {
    assert.deepEqual(pagination({ limit: 'abc', offset: 'xyz' }), { limit: DEFAULT_LIMIT, offset: 0 });
  });
});

describe('busquedaTexto', () => {
  it('devuelve un objeto vacio cuando no hay texto', () => {
    assert.deepEqual(busquedaTexto('', ['nombre']), {});
    assert.deepEqual(busquedaTexto('   ', ['nombre']), {});
    assert.deepEqual(busquedaTexto(null, ['nombre']), {});
  });

  it('arma un OR por cada campo, ya recortado', () => {
    const filtro = busquedaTexto('  Ana ', ['nombre', 'documento']);

    assert.equal(filtro.OR.length, 2);
    assert.equal(filtro.OR[0].nombre.contains, 'Ana');
    assert.equal(filtro.OR[1].documento.contains, 'Ana');
  });

  it('no lleva `mode: insensitive`, que es solo de PostgreSQL', () => {
    /*
     * SQLite no lo admite y Prisma falla con un error poco claro si se le pasa.
     * Aqui no hace falta: el LIKE de SQLite ya es insensible a las mayusculas para
     * el rango ASCII. Los acentos ("Muñoz" contra "muñoz") no se comparan; para eso
     * haria falta FTS5.
     */
    const filtro = busquedaTexto('ana', ['nombre']);

    assert.equal('mode' in filtro.OR[0].nombre, false);
  });
});

describe('cursor', () => {
  const registro = { id: 42, createdAt: new Date('2026-10-20T10:00:00.000Z') };

  it('codifica y decodifica sin perder datos', () => {
    const cursor = codificarCursor(registro);
    const punto = decodificarCursor(cursor);

    assert.equal(punto.id, 42);
    assert.equal(punto.createdAt.toISOString(), '2026-10-20T10:00:00.000Z');
  });

  it('el cursor no lleva caracteres que hay que escapar en la URL', () => {
    /// base64url y no base64: los caracteres + / = rompen una query string si no se
    /// escapan, y el cursor va en la URL de todas las peticiones.
    const cursor = codificarCursor({ id: 1, createdAt: new Date() });
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  });

  it('devuelve null para lo que no es un cursor', () => {
    assert.equal(decodificarCursor(''), null);
    assert.equal(decodificarCursor(null), null);
    assert.equal(decodificarCursor('no-es-base64!!'), null);
    assert.equal(codificarCursor(null), null);
  });

  it('rechaza un cursor con un id que no es numero', () => {
    const roto = Buffer.from(JSON.stringify({ id: 'abc' })).toString('base64url');
    assert.equal(decodificarCursor(roto), null);
  });

  it('sin cursor no filtra nada', () => {
    assert.deepEqual(whereCursor(null), {});
    assert.deepEqual(whereCursor(''), {});
  });

  it('con cursor busca las filas mas nuevas que la ultima entregada', () => {
    const cursor = codificarCursor(registro);
    const where = whereCursor(cursor);

    assert.equal(where.OR.length, 2);
    assert.ok(where.OR[0].createdAt.lt instanceof Date);
    assert.equal(where.OR[1].createdAt instanceof Date, true);
  });

  it('con un cursor sin fecha cae al id, que tambien sirve para desempatar', () => {
    const cursor = codificarCursor({ id: 99 });
    const where = whereCursor(cursor);

    assert.equal(where.id.lt, 99);
  });
});
