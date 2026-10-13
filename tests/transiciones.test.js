import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADO_POR_ACCION,
  OCUPAN,
  STATUSES,
  TRANSITIONS,
} from '../src/api/appointment/appointment.validation.js';

/**
 * Transiciones de estado de una cita.
 *
 * Este archivo comprueba las TABLAS que gobiernan las transiciones. La logica que
 * las usa (`actuar` en `appointment.service.js`) necesita la base de datos, asi que
 * no se prueba aqui; lo que si se comprueba es que las tablas esten completas y
 * coherentes entre si, que es donde se rompe cuando se anade un estado nuevo y se
 * olvida tocar el mapa.
 */

/** A donde puede ir cada estado, segun las reglas del negocio. */
const ESPERADO = {
  PENDING: ['COORDINATED', 'CANCELLED', 'REJECTED'],
  COORDINATED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
  NO_SHOW: [],
};

describe('mapa de transiciones', () => {
  it('tiene una entrada para cada estado', () => {
    /*
     * Si se anade un estado a `STATUSES` y se olvida el mapa, `actuar` hace
     * `TRANSITIONS[nuevo].includes(...)` sobre `undefined` y responde 500 donde
     * deberia responder 409. Este test es el que se entera.
     */
    assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...STATUSES].sort());
  });

  it('cada estado solo puede ir a los que el negocio permite', () => {
    for (const [desde, hasta] of Object.entries(ESPERADO)) {
      assert.deepEqual([...(TRANSITIONS[desde] ?? [])].sort(), [...hasta].sort(), `desde ${desde}`);
    }
  });

  it('no hay transiciones hacia estados que no existen', () => {
    for (const [desde, hasta] of Object.entries(TRANSITIONS)) {
      for (const destino of hasta) {
        assert.ok(STATUSES.includes(destino), `${desde} -> ${destino}: ${destino} no es un estado valido`);
      }
    }
  });

  it('nunca se puede volver a PENDING desde un estado cerrado', () => {
    /*
     * Volver a pendiente reabre una cita cancelada, y su hueco ya se ha devuelto a
     * la bolsa: la reserva queda apuntando a un bloque que otro cliente puede haber
     * cogido mientras tanto.
     */
    for (const estado of ['COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW']) {
      assert.equal(TRANSITIONS[estado].includes('PENDING'), false, `${estado} no puede volver a PENDING`);
    }
  });

  it('una cita confirmada no puede rechazarse', () => {
    /*
     * `REJECTED` significa "nunca llego a coordinarse". Una cita ya confirmada que se
     * rechaza deja al cliente con un correo de "te rechazamos" de algo que ya habia
     * confirmado. Para eso existe `CANCELLED`.
     */
    assert.equal(TRANSITIONS.COORDINATED.includes('REJECTED'), false);
  });
});

describe('estados que ocupan el hueco', () => {
  it('son los que todavia van a ocurrir', () => {
    assert.deepEqual([...OCUPAN].sort(), ['COORDINATED', 'PENDING']);
  });

  it('NO incluyen los estados que devuelven el bloque a la bolsa', () => {
    /*
     * COMPLETED y NO_SHOW no devuelven el hueco: el bloque se consumio. Si estuvieran
     * en `OCUPAN`, `liberarHuecos` los devolveria a la bolsa y otro cliente podria
     * reservarlos el mismo dia.
     */
    for (const estado of ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'REJECTED']) {
      assert.equal(OCUPAN.includes(estado), false, `${estado} no ocupa el hueco`);
    }
  });

  it('todo estado que ocupa el hueco esta en la lista de estados', () => {
    for (const estado of OCUPAN) {
      assert.ok(STATUSES.includes(estado), `${estado} no es un estado valido`);
    }
  });
});

describe('acciones de la API', () => {
  it('cada accion produce un estado real', () => {
    for (const [accion, estado] of Object.entries(ESTADO_POR_ACCION)) {
      assert.ok(STATUSES.includes(estado), `${accion} -> ${estado}: estado desconocido`);
    }
  });

  it('cada accion sale de un estado que la tiene permitida', () => {
    /*
     * Una accion que llega a un estado desde el que no se puede llegar es un 409
     * garantizado, sin importar quien la llame.
     */
    for (const [accion, destino] of Object.entries(ESTADO_POR_ACCION)) {
      const desdeAlguno = Object.entries(TRANSITIONS).filter(([, hasta]) => hasta.includes(destino));

      assert.ok(desdeAlguno.length > 0, `${accion} -> ${destino}: ningun estado puede llegar ahi`);
    }
  });

  it('cancelar y cancelar-admin llevan al mismo sitio', () => {
    /// Son la misma accion con distinto permiso: el cliente cancela la suya y el
    /// equipo cancela cualquier cita. Si divergieran habria dos caminos a CANCELLED.
    assert.equal(ESTADO_POR_ACCION.cancelar, ESTADO_POR_ACCION['cancelar-admin']);
    assert.equal(ESTADO_POR_ACCION.cancelar, 'CANCELLED');
  });

  it('rechazar solo existe para lo pendiente', () => {
    assert.equal(ESTADO_POR_ACCION.rechazar, 'REJECTED');
    assert.ok(TRANSITIONS.PENDING.includes('REJECTED'));
    assert.equal(Object.values(TRANSITIONS).filter((h) => h.includes('REJECTED')).length, 1);
  });

  it('el check-in NO cambia el estado', () => {
    /*
     * El check-in es una marca de tiempo, no una transicion: registrar la llegada
     * no debe alterar el estado de la cita. Que no aparezca aqui es lo que lo
     * garantiza, porque `actuar` solo usa `ESTADO_POR_ACCION`.
     */
    assert.equal(Object.values(ESTADO_POR_ACCION).includes('CHECKED_IN'), false);
  });
});
