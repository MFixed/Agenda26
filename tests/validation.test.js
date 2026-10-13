import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  patterns,
  validatePattern,
  optionalPattern,
  validateInt,
  optionalInt,
  validateBool,
  validateOneOf,
  validateOrThrow,
  validatePatch,
} from '../src/utils/validation.js';
import { ApiError } from '../src/utils/ApiError.js';

/**
 * Validadores.
 *
 * Son la primera linea de defensa de la API y los unicos tests que no necesitan
 * base de datos. Si un patron se rompe, lo que falla es la validacion de entrada de
 * todo lo demas, y el error aparece lejos de su causa.
 */

describe('patrones', () => {
  it('acepta un email normal', () => {
    assert.equal(validatePattern('ana@ejemplo.com', 'email', 'email').valid, true);
    assert.equal(validatePattern('  ana@ejemplo.com  ', 'email', 'email').value, 'ana@ejemplo.com');
  });

  it('rechaza emails sin dominio o sin arroba', () => {
    assert.equal(validatePattern('ana@', 'email', 'email').valid, false);
    assert.equal(validatePattern('ana.ejemplo.com', 'email', 'email').valid, false);
    assert.equal(validatePattern('a b@ejemplo.com', 'email', 'email').valid, false);
  });

  it('exige 8 caracteres, minuscula, mayuscula y numero en la contrasena', () => {
    assert.equal(validatePattern('Cliente1234', 'password', 'password').valid, true);
    assert.equal(validatePattern('corta1A', 'password', 'password').valid, false, 'muy corta');
    assert.equal(validatePattern('sinmayuscula1', 'password', 'password').valid, false);
    assert.equal(validatePattern('SINMINUSCULA1', 'password', 'password').valid, false);
    assert.equal(validatePattern('SinNumeroAA', 'password', 'password').valid, false);
  });

  it('acepta telefono con espacios, guiones y +', () => {
    assert.equal(validatePattern('099 123 4567', 'telefono', 'telefono').valid, true);
    assert.equal(validatePattern('+598 99 123 4567', 'telefono', 'telefono').valid, true);
    assert.equal(validatePattern('abc', 'telefono', 'telefono').valid, false);
    assert.equal(validatePattern('09 1234abc', 'telefono', 'telefono').valid, false);
  });

  it('acepta HH:MM en 24 horas y rechaza lo que no lo es', () => {
    for (const hora of ['00:00', '09:30', '23:59']) {
      assert.equal(validatePattern(hora, 'time', 'startTime').valid, true, hora);
    }

    for (const hora of ['24:00', '9:30', '09:60', '09h30']) {
      assert.equal(validatePattern(hora, 'time', 'startTime').valid, false, hora);
    }
  });

  it('acepta YYYY-MM-DD y rechaza meses y dias imposibles', () => {
    assert.equal(validatePattern('2026-10-20', 'date', 'date').valid, true);

    for (const fecha of ['2026-13-01', '2026-00-10', '2026-10-32', '20/10/2026']) {
      assert.equal(validatePattern(fecha, 'date', 'date').valid, false, fecha);
    }
  });

  it('acepta slug en minusculas separadas por guiones', () => {
    assert.equal(validatePattern('clinica-ejemplo', 'slug', 'negocio').valid, true);
    assert.equal(validatePattern('clinica ejemplo', 'slug', 'negocio').valid, false);
    assert.equal(validatePattern('Clinica-Ejemplo', 'slug', 'negocio').valid, false);
  });

  it('distingue vacio de ausente en los campos obligatorios', () => {
    assert.equal(validatePattern('', 'nombre', 'nombre').valid, false);
    assert.equal(validatePattern('   ', 'nombre', 'nombre').valid, false);
    assert.equal(validatePattern(undefined, 'nombre', 'nombre').valid, false);
    assert.equal(validatePattern(null, 'nombre', 'nombre').valid, false);
  });
});

describe('optionalPattern', () => {
  it('trata vacio, null y ausente como lo mismo: NULL en la base', () => {
    for (const valor of [undefined, null, '', '   ']) {
      const r = optionalPattern(valor, 'telefono', 'telefono');
      assert.equal(r.valid, true, JSON.stringify(valor));
      assert.equal(r.value, null);
    }
  });

  it('valida cuando hay contenido', () => {
    assert.equal(optionalPattern('0991234567', 'telefono', 'telefono').value, '0991234567');
    assert.equal(optionalPattern('abc', 'telefono', 'telefono').valid, false);
  });
});

describe('enteros', () => {
  it('exige un entero de verdad', () => {
    assert.equal(validateInt(5, 'id').value, 5);
    assert.equal(validateInt('5', 'id').value, 5);
    assert.equal(validateInt(5.5, 'id').valid, false);
    assert.equal(validateInt('abc', 'id').valid, false);
  });

  it('respeta el minimo y el maximo', () => {
    assert.equal(validateInt(0, 'bufferMin', { min: 0 }).valid, true);
    assert.equal(validateInt(-1, 'bufferMin', { min: 0 }).valid, false);
    assert.equal(validateInt(481, 'slotMinutes', { max: 480 }).valid, false);
  });

  it('optionalInt devuelve null en vez de fallar', () => {
    assert.equal(optionalInt('', 'staffId').value, null);
    assert.equal(optionalInt(3, 'staffId').value, 3);
  });
});

describe('booleanos y enumeraciones', () => {
  it('acepta el booleano de verdad y el de la query string', () => {
    assert.equal(validateBool(true, 'activo').value, true);
    assert.equal(validateBool('true', 'activo').value, true);
    assert.equal(validateBool('false', 'activo').value, false);
    assert.equal(validateBool(1, 'activo').valid, false);
    assert.equal(validateBool('si', 'activo').valid, false);
  });

  it('lista los valores validos en el mensaje', () => {
    const r = validateOneOf('VOLADO', ['PENDING', 'COMPLETED'], 'estado');
    assert.equal(r.valid, false);
    assert.match(r.message, /PENDING, COMPLETED/);
  });
});

describe('validateOrThrow', () => {
  it('devuelve el objeto limpio con trim y numeros convertidos', () => {
    const salida = validateOrThrow({
      nombre: validatePattern('  Ana  ', 'nombre', 'nombre'),
      clientId: validateInt('7', 'clientId'),
      telefono: optionalPattern('', 'telefono', 'telefono'),
    });

    assert.deepEqual(salida, { nombre: 'Ana', clientId: 7, telefono: null });
  });

  it('recoge TODOS los fallos, no solo el primero', () => {
    try {
      validateOrThrow({
        email: validatePattern('malo', 'email', 'email'),
        nombre: validatePattern('x', 'nombre', 'nombre'),
        password: validatePattern('corta', 'password', 'password'),
      });
      assert.fail('deberia lanzar');
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.details.length, 3, 'deben volver los tres fallos a la vez');
      assert.deepEqual(
        error.details.map((d) => d.field),
        ['email', 'nombre', 'password']
      );
    }
  });

  it('no lanza cuando todo es valido', () => {
    assert.doesNotThrow(() => validateOrThrow({ email: validatePattern('a@b.co', 'email', 'email') }));
  });
});

describe('validatePatch', () => {
  it('rechaza un cuerpo vacio', () => {
    assert.throws(
      () => validatePatch({}),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /ningun campo/);
        return true;
      }
    );
  });

  it('acepta un cuerpo con al menos un campo', () => {
    const salida = validatePatch({ nombre: validatePattern('Ana', 'nombre', 'nombre') });
    assert.deepEqual(salida, { nombre: 'Ana' });
  });

  it('un campo que se limpia a null SI es un cambio valido', () => {
    /// Borrar un campo es una edicion real: el service va a escribir NULL. Lo que
    /// no tiene sentido es un cuerpo donde NO viene nada, que es lo que comprueba
    /// el `validatePatch` de arriba.
    assert.deepEqual(validatePatch({ nota: optionalPattern('', 'nota', 'nota') }), { nota: null });
  });
});

describe('patrones exportados', () => {
  it('el patron de contrasena exige los cuatro requisitos a la vez', () => {
    assert.equal(patterns.password.test('Cliente1234'), true);
    assert.equal(patterns.password.test('cliente1234'), false);
    assert.equal(patterns.password.test('CLIENTE1234'), false);
    assert.equal(patterns.password.test('Clienteabcd'), false);
  });
});
