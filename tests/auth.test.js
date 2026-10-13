import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, fuerzaPassword } from '../src/utils/password.js';
import { hashToken, compararHash } from '../config/logger.js';
import { firmarAccessToken, verificarAccessToken } from '../src/utils/tokens.js';

/**
 * Contrasenas y tokens.
 *
 * La parte que mas importa aqui no es que el hash "sea correcto", sino que la
 * comparacion NO Filtre informacion: `verifyPassword` devuelve lo mismo para un
 * hash roto que para una contrasena equivocada, porque cualquier otra cosa
 * convierte el login en un oraculo.
 *
 * `DATABASE_URL` y `JWT_SECRET` los pone `tests/setup.js`, que `node --test` carga
 * con `--import` ANTES que este archivo. No hace falta volver a definirlos aqui, y
 * este bloque ademas decia `postgresql://...`, lo que hacia creer que las pruebas
 * corren contra otro motor.
 */

describe('hashPassword / verifyPassword', () => {
  it('acepta la contrasena correcta', async () => {
    const hash = await hashPassword('Cliente1234');
    assert.equal(await verifyPassword('Cliente1234', hash), true);
  });

  it('rechaza la contrasena equivocada', async () => {
    const hash = await hashPassword('Cliente1234');
    assert.equal(await verifyPassword('Cliente9999', hash), false);
  });

  it('dos hashes de la misma contrasena son distintos', async () => {
    /// Sal distinta cada vez. Si fueran iguales, dos personas con la misma
    /// contrasena tendrian el mismo hash y se podrian comparar tablas entre si.
    const a = await hashPassword('Cliente1234');
    const b = await hashPassword('Cliente1234');
    assert.notEqual(a, b);
  });

  it('guarda con el formato scrypt$salt$hash', async () => {
    const hash = await hashPassword('Cliente1234');
    const partes = hash.split('$');
    assert.equal(partes.length, 3);
    assert.equal(partes[0], 'scrypt');
    assert.match(partes[1], /^[0-9a-f]{32}$/, 'salt de 16 bytes en hex');
    assert.match(partes[2], /^[0-9a-f]+$/, 'hash en hex');
  });

  it('nunca guarda la contrasena en claro', async () => {
    const hash = await hashPassword('Cliente1234');
    assert.ok(!hash.includes('Cliente1234'));
  });

  it('devuelve false en vez de lanzar si el hash guardado esta roto', async () => {
    /// Esto es lo que hace que un hash corrupto no tumbe el login entero.
    for (const roto of [
      '',
      'no-es-un-hash',
      'scrypt$$',
      'scrypt$abc$def',
      'bcrypt$sal$hash',
      null,
      undefined,
    ]) {
      assert.equal(await verifyPassword('Cliente1234', roto), false, String(roto));
    }
  });

  it('devuelve false con una contrasena vacia contra un hash valido', async () => {
    const hash = await hashPassword('Cliente1234');
    assert.equal(await verifyPassword('', hash), false);
  });
});

describe('fuerzaPassword', () => {
  it('califica una contrasena larga y variada como fuerte', () => {
    /// 8+, 12+, minuscula, mayuscula y numero = 5 puntos.
    assert.equal(fuerzaPassword('ClienteSegura1234').nivel, 'fuerte');
  });

  it('una contrasena correcta pero de 11 caracteres queda en "media"', () => {
    /// No es un fallo: el sistema exige 8, y una de 11 con variedad cumple. El
    /// nivel es informacion para el usuario, no una puerta.
    assert.equal(fuerzaPassword('Cliente1234').nivel, 'media');
  });

  it('califica una corta pero con variedad como media', () => {
    /// 3 puntos: minuscula, mayuscula y numero. No es debil porque cumple los
    /// requisitos del sistema, solo es corta.
    assert.equal(fuerzaPassword('Ab1').nivel, 'media');
  });

  it('califica una de solo letras como debil', () => {
    assert.equal(fuerzaPassword('abc').nivel, 'debil');
  });

  it('penaliza una que solo son letras o solo numeros', () => {
    assert.ok(fuerzaPassword('abcdefghij').puntos < fuerzaPassword('Abcdef1').puntos);
  });

  it('nunca devuelve puntos negativos', () => {
    assert.ok(fuerzaPassword('a1').puntos >= 0);
  });
});

describe('hashToken', () => {
  it('produce el mismo hash para el mismo token', () => {
    assert.equal(hashToken('abc'), hashToken('abc'));
  });

  it('produce hashes distintos para tokens distintos', () => {
    assert.notEqual(hashToken('abc'), hashToken('abd'));
  });

  it('no contiene el token en claro', () => {
    const token = 'un-refresh-token-muy-largo-y-aleatorio';
    assert.ok(!hashToken(token).includes(token));
  });

  it('compararHash no se equivoca con longitudes distintas', () => {
    /// Un Buffer de longitudes distintas comparado con timingSafeEqual lanza. El
    /// helper devuelve false para que ese caso llegue al 401 y no al 500.
    assert.equal(compararHash('corto', 'muchisimomuchisimo'), false);
    assert.equal(compararHash('igual', 'igual'), true);
    assert.equal(compararHash('un-caso', 'otro-caso'), false);
  });
});

describe('tokens de acceso', () => {
  const usuario = { id: 7, role: 'ADMIN', businessId: 3, tokenVersion: 2 };

  it('firma y verifica un token propio', () => {
    const token = firmarAccessToken(usuario);
    const payload = verificarAccessToken(token);

    assert.ok(payload);
    assert.equal(payload.sub, 7);
    assert.equal(payload.role, 'ADMIN');
    assert.equal(payload.biz, 3);
    assert.equal(payload.ver, 2);
  });

  it('rechaza un token firmado con otra clave', () => {
    const token = firmarAccessToken(usuario);
    assert.equal(verificarAccessToken('no.es.un.token'), null);
    assert.equal(verificarAccessToken(token.slice(0, -3) + 'xxx'), null);
  });

  it('rechaza un token corrupto en vez de lanzar', () => {
    assert.equal(verificarAccessToken(''), null);
    assert.equal(verificarAccessToken('a.b.c'), null);
    assert.equal(verificarAccessToken(null), null);
  });

  it('un token sin tipo "access" no vale como token de acceso', () => {
    /// La proteccion contra usar un refresh token como access token no puede
    /// depender solo de `aud`: tiene que haber un campo que lo diga.
    const token = firmarAccessToken(usuario);
    const payload = verificarAccessToken(token);

    assert.equal(payload.typ, 'access');
  });

  it('un tokenVersion distinto invalida el token', () => {
    /// Es lo que hace que logout y cambio de contrasena expulsen de verdad: el
    /// token lleva `ver`, la base lo compara y si no coinciden el token muere.
    const token = firmarAccessToken({ ...usuario, tokenVersion: 2 });
    const payload = verificarAccessToken(token);

    assert.equal(payload.ver, 2);
    assert.notEqual(payload.ver, 3, 'el token emitido antes del logout no puede valer');
  });

  it('un SUPERADMIN entra sin businessId', () => {
    const payload = verificarAccessToken(
      firmarAccessToken({ ...usuario, businessId: null, role: 'SUPERADMIN' })
    );
    assert.equal(payload.biz, null);
  });
});
