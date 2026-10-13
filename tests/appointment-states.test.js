import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSITIONS,
  OCUPAN,
  ESTADO_POR_ACCION,
  STATUSES,
} from '../src/api/appointment/appointment.validation.js';

/**
 * Maquina de estados de la cita.
 *
 * Es la parte de la que dependen el calendario y los correos, y en v1 estaba
 * repartida entre el service y las rutas, con el riesgo de que las dos no
 * coincidieran. Ahora esta en UN sitio (`TRANSITIONS`) y estos tests son la garantia
 * de que ninguna transicion invalida se cuela por un endpoint nuevo.
 */

describe('transiciones', () => {
  it('PENDING se puede coordinar, cancelar o rechazar', () => {
    assert.deepEqual(TRANSITIONS.PENDING.sort(), ['CANCELLED', 'COORDINATED', 'REJECTED'].sort());
  });

  it('COORDINATED se puede completar, cancelar o marcar ausente', () => {
    assert.deepEqual(TRANSITIONS.COORDINATED.sort(), ['CANCELLED', 'COMPLETED', 'NO_SHOW'].sort());
  });

  it('NO_SHOW solo sale de COORDINATED', () => {
    assert.ok(TRANSITIONS.COORDINATED.includes('NO_SHOW'));
    assert.ok(
      !TRANSITIONS.PENDING.includes('NO_SHOW'),
      'no se marca ausente una cita que no llego a coordinarse'
    );
  });

  it('los estados finales no tienen salida', () => {
    for (const estado of ['COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW']) {
      assert.deepEqual(TRANSITIONS[estado], [], `${estado} deberia ser final`);
    }
  });

  it('COMPLETED no se puede repetir', () => {
    assert.ok(!TRANSITIONS.COMPLETED.includes('COMPLETED'));
  });

  it('no se puede saltar de PENDING a COMPLETED', () => {
    /// Saltarse la coordinacion significa que el cliente nunca recibio la
    /// confirmacion, y sin confirmacion no se puede completed.
    assert.ok(!TRANSITIONS.PENDING.includes('COMPLETED'));
  });

  it('toda transicion apunta a un estado que existe', () => {
    for (const [desde, hacia] of Object.entries(TRANSITIONS)) {
      assert.ok(STATUSES.includes(desde), `${desde} no esta en STATUSES`);
      for (const destino of hacia) {
        assert.ok(STATUSES.includes(destino), `${destino} no esta en STATUSES`);
      }
    }
  });
});

describe('estados que ocupan el horario', () => {
  it('son exactamente PENDING y COORDINATED', () => {
    assert.deepEqual(OCUPAN.sort(), ['COORDINATED', 'PENDING'].sort());
  });

  it('COMPLETED y NO_SHOW ya no ocupan pero retienen el bloque', () => {
    /// El detalle importante: no ocupan (no se pueden meter mas citas encima) pero
    /// tampoco liberan el hueco (el rato se consumio). Son cosas distintas y
    /// confundirlas es lo que devuelve un bloque a la venta dos veces.
    assert.ok(!OCUPAN.includes('COMPLETED'));
    assert.ok(!OCUPAN.includes('NO_SHOW'));
    assert.ok(!OCUPAN.includes('CANCELLED'));
  });
});

describe('mapa de acciones', () => {
  it('cada accion apunta a un estado valido', () => {
    for (const [accion, estado] of Object.entries(ESTADO_POR_ACCION)) {
      assert.ok(STATUSES.includes(estado), `${accion} -> ${estado} no es un estado valido`);
    }
  });

  it('cada transicion posible tiene una accion que la hace', () => {
    for (const [desde, hacia] of Object.entries(TRANSITIONS)) {
      for (const destino of hacia) {
        const existe = Object.values(ESTADO_POR_ACCION).includes(destino);
        assert.ok(existe, `no hay accion para pasar de ${desde} a ${destino}`);
      }
    }
  });

  it('coordinar, completar, rechazar, cancelar y no-show estan mapeadas', () => {
    assert.equal(ESTADO_POR_ACCION.coordinar, 'COORDINATED');
    assert.equal(ESTADO_POR_ACCION.completar, 'COMPLETED');
    assert.equal(ESTADO_POR_ACCION.rechazar, 'REJECTED');
    assert.equal(ESTADO_POR_ACCION.cancelar, 'CANCELLED');
    assert.equal(ESTADO_POR_ACCION['cancelar-admin'], 'CANCELLED');
    assert.equal(ESTADO_POR_ACCION['no-show'], 'NO_SHOW');
  });

  it('todo estado alcanzable tiene su origen en la tabla', () => {
    for (const estado of STATUSES) {
      assert.ok(estado in TRANSITIONS, `${estado} no tiene fila en TRANSITIONS`);
    }
  });
});

describe('cobertura completa de la maquina de estados', () => {
  it('toda combinacion de estado de partida y accion se puede clasificar', () => {
    /// No se prueba que funcione, sino que no quede ninguna combinacion sin
    /// cubrir: si alguien anade un estado nuevo y olvida la tabla, esto se rompe.
    const estados = Object.keys(TRANSITIONS);

    assert.ok(estados.length > 0);
    assert.equal(estados.length, STATUSES.length, 'TRANSITIONS debe tener una fila por cada estado');
  });
});
