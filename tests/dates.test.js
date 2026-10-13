import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  zonaValida,
  parseDateOnly,
  formatDateOnly,
  hoyEn,
  sumarDias,
  diasEntre,
  diaDeSemana,
  sumarMinutos,
  minutosEntre,
  formatearEn,
} from '../src/utils/dates.js';

/**
 * Fechas y zonas horarias.
 *
 * Este modulo tiene la logica mas facil de equivocar de todo el proyecto, porque todo
 * el mundo parece lo mismo hasta que alguien pide la agenda un dia de octubre a las
 * 22:00 y le sale el dia siguiente. Los tests van justos ahi.
 */

describe('parseDateOnly / formatDateOnly', () => {
  it('va y vuelve sin cambiar el dia', () => {
    assert.equal(formatDateOnly(parseDateOnly('2026-10-20')), '2026-10-20');
  });

  it('guarda el dia a medianoche UTC', () => {
    /// Si esto cambia, el formato del .ics y del correo se corren un dia.
    assert.equal(parseDateOnly('2026-10-20').toISOString(), '2026-10-20T00:00:00.000Z');
  });

  it('devuelve null para lo que no es una fecha', () => {
    assert.equal(formatDateOnly(null), null);
    assert.equal(formatDateOnly(undefined), null);
    assert.equal(formatDateOnly('no es una fecha'), null);
  });
});

describe('zonaValida', () => {
  it('acepta zonas IANA reales', () => {
    assert.equal(zonaValida('America/Montevideo'), true);
    assert.equal(zonaValida('UTC'), true);
    assert.equal(zonaValida('Europe/Madrid'), true);
  });

  it('rechaza lo que no es una zona', () => {
    assert.equal(zonaValida('America/NoExiste'), false);
    assert.equal(zonaValida('Montevideo'), false);
    assert.equal(zonaValida(''), false);
    assert.equal(zonaValida(null), false);
    assert.equal(zonaValida(123), false);
  });
});

describe('hoyEn', () => {
  it('calcula el hoy del negocio, no el del servidor', () => {
    /// 2026-10-20T02:00Z. En UTC es el dia 20; en Montevideo (UTC-3) todavia es el 19.
    const instante = new Date('2026-10-20T02:00:00.000Z');

    assert.equal(hoyEn('UTC', instante), '2026-10-20');
    assert.equal(hoyEn('America/Montevideo', instante), '2026-10-19');
  });

  it('cae en UTC si la zona no es valida, en vez de reventar', () => {
    const instante = new Date('2026-10-20T02:00:00.000Z');
    assert.equal(hoyEn('America/NoExiste', instante), '2026-10-20');
  });

  it('el desfase de una noche es exactamente el que importa para la agenda', () => {
    /// Este es el bug que motivo tener zona en el negocio: un cliente que abre la
    /// agenda a las 22:00 en Montevideo veia el dia siguiente y no encontraba nada.
    const instante = new Date('2026-10-20T01:00:00.000Z');
    assert.equal(hoyEn('America/Montevideo', instante), '2026-10-19');
    assert.equal(hoyEn('Asia/Tokyo', instante), '2026-10-20');
  });
});

describe('aritmetica de fechas', () => {
  it('suma dias cruzando el cambio de mes', () => {
    assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
    assert.equal(sumarDias('2026-01-01', -1), '2025-12-31');
  });

  it('suma dias cruzando el ano', () => {
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  });

  it('cuenta dias incluyendo ambos extremos', () => {
    assert.equal(diasEntre('2026-10-20', '2026-10-20'), 1);
    assert.equal(diasEntre('2026-10-20', '2026-10-27'), 8);
  });
});

describe('diaDeSemana', () => {
  it('devuelve 0 domingo ... 6 sabado', () => {
    assert.equal(diaDeSemana('2026-10-18'), 0, 'domingo');
    assert.equal(diaDeSemana('2026-10-19'), 1, 'lunes');
    assert.equal(diaDeSemana('2026-10-24'), 6, 'sabado');
  });
});

describe('horas', () => {
  it('calcula los minutos entre dos horas', () => {
    assert.equal(minutosEntre('09:00', '10:00'), 60);
    assert.equal(minutosEntre('09:15', '09:45'), 30);
    assert.equal(minutosEntre('23:00', '23:59'), 59);
  });

  it('devuelve negativo si el final es anterior', () => {
    assert.equal(minutosEntre('10:00', '09:00'), -60);
    assert.equal(minutosEntre('09:00', '09:00'), 0);
  });

  it('suma minutos dentro del dia', () => {
    assert.equal(sumarMinutos('09:00', 60).hora, '10:00');
    assert.equal(sumarMinutos('09:30', 45).hora, '10:15');
    assert.equal(sumarMinutos('23:30', 60).hora, '00:30');
    assert.equal(sumarMinutos('23:30', 60).diasExtra, 1);
  });

  it('suma minutos hacia atras', () => {
    assert.equal(sumarMinutos('00:30', -60).hora, '23:30');
    assert.equal(sumarMinutos('00:30', -60).diasExtra, -1);
  });

  it('la comparacion de franjas funciona comparando texto', () => {
    /// Es como decide el solape: "09:00" < "10:00" como texto, porque los dos
    /// tienen el mismo formato. Sin esto habria que convertir a Date, que es donde
    /// empiezan los fallos de zona horaria.
    assert.ok('09:00' < '10:00');
    assert.ok('09:30' > '09:00');
    assert.ok(!('23:00' < '09:00'));
  });
});

describe('formatearEn', () => {
  it('muestra la misma fecha en dos zonas si el instante es el mismo', () => {
    const instante = new Date('2026-10-20T02:00:00.000Z');

    assert.equal(formatearEn(instante, 'UTC'), '2026-10-20 02:00');
    assert.equal(formatearEn(instante, 'America/Montevideo'), '2026-10-19 23:00');
  });

  it('sin hora devuelve solo la fecha', () => {
    const instante = new Date('2026-10-20T02:00:00.000Z');
    assert.equal(formatearEn(instante, 'UTC', false), '2026-10-20');
  });
});
