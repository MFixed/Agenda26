import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { instanteEn, formatearEn } from '../src/utils/dates.js';

/**
 * `instanteEn`: de "el 20/10 a las 21:00 en Montevideo" al instante real.
 *
 * Este helper estaba sin cobertura y con un error de sintaxis (`constaprox`) dentro.
 * No reventaba antes porque solo lo usan el worker de recordatorios y la
 * reprogramacion de citas, rutas que no se ejecutan en los tests: el worker solo
 * llama a `instanteEn` cuando hay alguna cita COORDINADA, y en una base de pruebas
 * suele no haberla.
 *
 * El fallo era invisible (el planificador se salta los errores) y cuando se hacia
 * cargo, los recordatorios no se programaban.
 */

describe('instanteEn', () => {
  it('en UTC, la hora es la misma', () => {
    const instante = instanteEn('2026-10-20', '21:00', 'UTC');

    assert.equal(instante.toISOString(), '2026-10-20T21:00:00.000Z');
  });

  it('en Montevideo (UTC-3) son las 21:00 cuando aqui son las 00:00 del dia siguiente', () => {
    /*
     * Esta es toda la razon de ser del helper. La cita es "el 20/10 a las 21:00, hora
     * de Montevideo". En UTC eso es el 21/10 a las 00:00.
     *
     * Sin la conversion, el recordatorio se mandaria tres horas antes de la cita, o
     * el evento del .ics caeria a una hora que el cliente no recone.
     */
    const instante = instanteEn('2026-10-20', '21:00', 'America/Montevideo');

    assert.equal(instante.toISOString(), '2026-10-21T00:00:00.000Z');
  });

  it('al revés: una cita de madrugada en Montevideo es el dia anterior en UTC', () => {
    const instante = instanteEn('2026-10-20', '02:00', 'America/Montevideo');

    assert.equal(instante.toISOString(), '2026-10-20T05:00:00.000Z');
  });

  it('la ida y la vuelta por formatearEn conserva la hora de la zona', () => {
    const instante = instanteEn('2026-10-20', '21:00', 'America/Montevideo');

    assert.equal(formatearEn(instante, 'America/Montevideo'), '2026-10-20 21:00');
  });

  it('el desplazamiento se calcula por fecha, no como una constante', () => {
    /*
     * Montevideo UTC-3 todo el ano, pero Madrid no: en invierno es UTC+1 y en verano
     * UTC+2. Una tabla fija de desplazamientos daria tres horas de error a media
     * anyways del ano, y solo en verano apareceria el fallo.
     */
    const invierno = instanteEn('2026-01-15', '12:00', 'Europe/Madrid');
    const verano = instanteEn('2026-07-15', '12:00', 'Europe/Madrid');

    assert.equal(invierno.toISOString(), '2026-01-15T11:00:00.000Z', 'UTC+1 en enero');
    assert.equal(verano.toISOString(), '2026-07-15T10:00:00.000Z', 'UTC+2 en julio');

    /*
     * `getUTCHours`, no `getHours`.
     *
     * `getHours()` devuelve la hora LOCAL de la maquina que corre el test. En una
     * maquina con `TZ=Europe/Madrid` las dos son las 12:00 (CET +1 en enero, CEST
     * +2 en julio) y el `notEqual` falla, con un test que depende de donde se
     * ejecuta. Los dos `toISOString` de arriba ya comparan en UTC, que es lo que
     * importa: aqui solo se comprueba que los offsets difieren.
     */
    assert.notEqual(
      invierno.getUTCHours(),
      verano.getUTCHours(),
      'los offsets de invierno y verano difieren'
    );
  });

  it('con una zona invalida avisa con un error claro', () => {
    /*
     * El nombre del test decia "no explota" y la asercion decia lo contrario.
     *
     * `Intl` lanza `RangeError` con una zona que no existe, y aqui NO se captura:
     * para entonces la zona ya se ha validado en `business.validation.js`
     * (`zonaValida`), con lo que llegar hasta aqui significa que alguien la metio por
     * la puerta de atras. Un error claro ("zona no valida") es mejor que una excepcion
     * de Intl a mitad del calculo de una reprogramacion.
     */
    assert.throws(
      () => instanteEn('2026-10-20', '21:00', 'America/NoExiste'),
      /zona|zone|Invalid|RangeError/i,
      'debe fallar con un error que se entienda'
    );
  });

  it('el resultado es un Date utilizable', () => {
    const instante = instanteEn('2026-10-20', '09:00', 'UTC');

    assert.ok(instante instanceof Date);
    assert.equal(Number.isNaN(instante.getTime()), false);
    assert.equal(instante.getUTCFullYear(), 2026);
    assert.equal(instante.getUTCMonth(), 9);
    assert.equal(instante.getUTCDate(), 20);
  });
});
