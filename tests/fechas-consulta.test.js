import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hoyEn, parseDateOnly, formatDateOnly } from '../src/utils/dates.js';

/**
 * Textos de fecha frente a objetos Date.
 *
 * El fallo que cubre: el worker de recordatorios pasaba `hoyEn(zona)` (un STRING) a
 * un filtro `gte` de Prisma, que en SQLite exige un `Date`. El error era
 * "Invalid value for argument gte: premature end of input", la tarea reventaba y,
 * como el planificador se salta los fallos, el proceso seguia en pie: los
 * recordatorios simplemente nunca se programaban y no se notaba por ningun lado.
 *
 * Estos tests separan las dos cosas para que la confusion no vuelva.
 */

describe('hoyEn devuelve texto, parseDateOnly devuelve Date', () => {
  const instante = new Date('2026-10-20T02:00:00.000Z');

  it('hoyEn devuelve un string YYYY-MM-DD', () => {
    const valor = hoyEn('UTC', instante);

    assert.equal(typeof valor, 'string', 'hoyEn es para pintar o comparar como texto');
    assert.match(valor, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('parseDateOnly devuelve un Date real', () => {
    const valor = parseDateOnly(hoyEn('UTC', instante));

    assert.ok(valor instanceof Date);
    assert.equal(valor.toISOString(), '2026-10-20T00:00:00.000Z');
  });

  it('el texto de hoyEn es parseable, pero Prisma no lo acepta igual', () => {
    /*
     * Esto es lo que confunde.
     *
     * `new Date("2026-10-20")` en JavaScript SÍ funciona: la cadena se convierte sola.
     * Por eso parece que pasar el texto a Prisma deberia funcionar tambien, y el
     * error que sale es muy poco explicito: "Invalid value for argument gte:
     * premature end of input. Expected ISO-8601 DateTime" no dice "me has dado un
     * string donde quiero un Date".
     *
     * Prisma valida el TIPO antes de tocar la base, asi que ni llega al motor. Por
     * eso la conversion hay que hacerla a proposito, aunque el valor sea el mismo.
     */
    const comoTexto = hoyEn('UTC', instante);

    assert.equal(typeof comoTexto, 'string');
    assert.equal(formatDateOnly(new Date(comoTexto)), comoTexto, 'el texto se puede reparsear sin perdida');

    /// Y aun asi, lo que Prisma exige es el objeto:
    assert.notEqual(typeof comoTexto, 'object');
  });

  it('parseDateOnly(hoyEn(z)) es el camino correcto para un gte', () => {
    const paraConsulta = parseDateOnly(hoyEn('America/Montevideo', instante));

    assert.ok(paraConsulta instanceof Date);
    assert.equal(Number.isNaN(paraConsulta.getTime()), false);
  });
});

describe('formatDateOnly acepta lo que devuelve Prisma', () => {
  it('redondea a Date', () => {
    assert.equal(formatDateOnly('2026-10-20'), '2026-10-20');
    assert.equal(formatDateOnly(new Date('2026-10-20T00:00:00.000Z')), '2026-10-20');
  });

  it('devuelve null en vez de un "Invalid Date" que se imprimiria como NaN', () => {
    /// Un `Invalid Date` que pasa a un template literal sale como "Invalid Date" en
    /// pantalla. `null` sale como hueco, que es menos confuso.
    assert.equal(formatDateOnly('no es una fecha'), null);
  });
});

describe('regla de uso en consultas', () => {
  it('todo filtro de rango sobre una columna de fecha necesita parseDateOnly', () => {
    /*
     * Documentacion en forma de test: si alguien escribe `gte: hoyEn(...)` en un
     * filtro, este fichero es el recordatorio de por que falla.
     */
    const patronCorrecto = { gte: parseDateOnly(hoyEn('UTC')) };
    const patronRoto = { gte: hoyEn('UTC') };

    assert.ok(patronCorrecto.gte instanceof Date);
    assert.equal(typeof patronRoto.gte, 'string', 'este es el que rompe');
  });
});
