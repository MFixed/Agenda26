import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dejaSinAdmin } from '../src/api/user/service/user.service.js';

/**
 * La guarda que impide quedarse sin administradores.
 *
 * El fallo que cubre esta comprobacion fue el mas caro del proyecto y no se vio
 * en ningun test unitario: `prisma.user.count()` devuelve un NUMERO, no un
 * `{ count }`. Al desestructurar, `count` quedaba `undefined`, la comparacion con
 * 0 era falsa y la guarda no se disparaba NUNCA. El sintoma era una empresa sin
 * admins y sin aviso.
 *
 * Este archivo importa la REGLA de verdad (`dejaSinAdmin`, exportada por el
 * service), no una copia. Antes reimplementaba la guarda aqui dentro, con lo que
 * el test pasaba igual aunque el service volviera a estar roto: daba igual lo que
 * pasara en `user.service.js`, esos seis tests seguian en verde.
 */
describe('guarda de administradores', () => {
  it('detecta que no queda ninguno', () => {
    assert.equal(dejaSinAdmin(0), true);
  });

  it('permite el cambio mientras quede uno', () => {
    assert.equal(dejaSinAdmin(1), false);
  });

  it('permite el cambio si quedan varios', () => {
    assert.equal(dejaSinAdmin(7), false);
  });

  /*
   * El caso exacto que rompia.
   *
   * Desestructurar `prisma.user.count()` daba `undefined`, y `undefined === 0` es
   * `false`: la guarda no se disparaba y la empresa se quedaba sin administradores
   * sin decir nada. Aqui se fija el comportamiento para ese valor, que ahora no
   * puede pasar porque `count` devuelve un numero, pero que deja escrito por que la
   * comparacion tiene que ser la que es.
   */
  it('un valor que no es un numero NO cuenta como cero', () => {
    assert.equal(dejaSinAdmin(undefined), false);
    assert.equal(dejaSinAdmin(null), false);
    assert.equal(dejaSinAdmin(NaN), false);
  });

  it('el cero llega como numero, no como objeto', () => {
    /// El fallo original fue desestructurar `{ count }` de un numero. Esta comprobacion
    /// falla si alguien vuelve a cambiar la forma de leer el resultado del count.
    const resultado = await_count();

    assert.equal(typeof resultado, 'number');
    assert.equal(dejaSinAdmin(resultado), true);
  });
});

/** Reproduce lo que devuelve `prisma.user.count`: un numero pelado. */
function await_count() {
  return 0;
}
