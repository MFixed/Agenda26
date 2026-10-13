import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRules } from '../src/api/appointment/appointment.validation.js';
import {
  createRules as clienteRules,
  updateRules as clienteUpdate,
} from '../src/api/client/client.validation.js';
import { createRules as categoriaRules } from '../src/api/category/category.validation.js';
import {
  createRules as negocioRules,
  updateRules as negocioUpdate,
} from '../src/api/business/business.validation.js';
import { createRules as usuarioRules } from '../src/api/user/user.validation.js';
import { registerRules, resetRules, loginRules, passwordRules } from '../src/api/auth/auth.validation.js';
import { ApiError } from '../src/utils/ApiError.js';

/**
 * Reglas de validacion por endpoint.
 *
 * Comprueban las reglas DE NEGOCIO, no el formato (eso lo cubren los validadores
 * genericos): aqui esta lo que en v1 no existia y se ha anadido en v2.
 *
 * Nota sobre como se comprueban los errores: el mensaje de un ApiError de
 * validacion es SIEMPRE "Revisa los datos del formulario". El campo concreto va en
 * `details`. Por eso las aserciones miran `details` y no `message`: comprobar el
 * mensaje seria comprobar la cadena fija, que no prueba nada.
 */

/** Ejecuta fn y devuelve el ApiError. Falla el test si no lanza un. */
function falla(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, `esperaba un ApiError, llego ${error}`);
    return error;
  }

  assert.fail('se esperaba un error y no hubo ninguno');
}

const camposDe = (error) => error.details.map((d) => d.field);
const mensajeDe = (error, campo) => error.details.find((d) => d.field === campo)?.message;

describe('alta de cita', () => {
  const base = { availabilityId: 3 };

  it('empieza en PENDING si no se dice nada', () => {
    assert.equal(createRules(base).status, 'PENDING');
  });

  it('la administracion puede crearla ya coordinada', () => {
    assert.equal(createRules({ ...base, status: 'COORDINATED' }).status, 'COORDINATED');
  });

  it('nadie puede crearla ya completada', () => {
    /// Una cita que nace COMPLETED no tendria evento PENDING ni habria pasado por
    /// el cliente: el historial seria una mentira.
    const error = falla(() => createRules({ ...base, status: 'COMPLETED' }));
    assert.match(error.message, /PENDING o COORDINATED/);
  });

  it('exige el hueco', () => {
    const error = falla(() => createRules({}));
    assert.deepEqual(camposDe(error), ['availabilityId']);
    assert.match(mensajeDe(error, 'availabilityId'), /obligatorio/);
  });

  it('rechaza un hueco que no es un entero', () => {
    const error = falla(() => createRules({ availabilityId: 'tres' }));
    assert.match(mensajeDe(error, 'availabilityId'), /entero/);
  });

  it('acepta los datos opcionales de una cita completa', () => {
    const cita = createRules({
      availabilityId: 3,
      clientId: 1,
      categoryId: 2,
      staffId: 5,
      title: 'Limpieza dental',
      note: 'Por la manana',
    });

    assert.equal(cita.clientId, 1);
    assert.equal(cita.staffId, 5);
    assert.equal(cita.title, 'Limpieza dental');
  });

  it('deja el cliente en null si no viene, para que el service lo resuelva segun el rol', () => {
    assert.equal(createRules(base).clientId, null);
  });
});

describe('alta de cliente', () => {
  const ficha = {
    nombre: 'Ana Martinez',
    documento: '12345678',
    fechaNacimiento: '1990-04-12',
    email: 'ana@ejemplo.com',
  };

  it('exige los campos obligatorios de la ficha', () => {
    for (const campo of ['nombre', 'documento', 'fechaNacimiento', 'email']) {
      const error = falla(() => clienteRules({ ...ficha, [campo]: undefined }));
      assert.ok(camposDe(error).includes(campo), `deberia avisar de ${campo}`);
    }
  });

  it('devuelve TODOS los campos que faltan de una vez', () => {
    const error = falla(() => clienteRules({}));
    assert.ok(error.details.length >= 4, 'deben volver todos a la vez, no solo el primero');
  });

  it('sin contrasena no falla: el service genera una temporal', () => {
    /// Que se genere una temporal es una decision: la administracion da de alta
    /// clientes en mostrador y casi nunca se le ocurre una contrasena.
    const cliente = clienteRules(ficha);
    assert.equal(cliente.password, undefined);
  });

  it('con contrasena la valida', () => {
    assert.equal(clienteRules({ ...ficha, password: 'Temporal1234' }).password, 'Temporal1234');

    const error = falla(() => clienteRules({ ...ficha, password: 'corta' }));
    assert.match(mensajeDe(error, 'password'), /al menos 8 caracteres/);
  });

  it('acepta las notas de la ficha (nuevo en v2)', () => {
    assert.equal(
      clienteRules({ ...ficha, notas: 'Alergia a la penicilina' }).notas,
      'Alergia a la penicilina'
    );
  });

  it('rechaza una actualizacion vacia', () => {
    assert.match(falla(() => clienteUpdate({})).message, /ningun campo/);
  });

  it('la actualizacion acepta tocar solo el estado', () => {
    assert.deepEqual(clienteUpdate({ activo: false }), { activo: false });
  });

  it('la actualizacion acepta un valor booleano en vez de string', () => {
    assert.deepEqual(clienteUpdate({ activo: true }), { activo: true });
  });
});

describe('categorias', () => {
  it('asigna una duracion por defecto de 60 minutos', () => {
    assert.equal(categoriaRules({ name: 'SERVICIOS' }).durationMin, 60);
  });

  it('acepta una duracion corta para un servicio corto', () => {
    /// El caso que en v1 no se podia expresar: una consulta de 15 minutos y una
    /// cirugia de 4 horas ocupaban el mismo hueco.
    assert.equal(categoriaRules({ name: 'Consulta rapida', durationMin: 15 }).durationMin, 15);
    assert.equal(categoriaRules({ name: 'Cirugia mayor', durationMin: 240 }).durationMin, 240);
  });

  it('rechaza duraciones que no tienen sentido', () => {
    assert.ok(
      camposDe(falla(() => categoriaRules({ name: 'Corto', durationMin: 2 }))).includes('durationMin')
    );
    assert.ok(
      camposDe(falla(() => categoriaRules({ name: 'Largo', durationMin: 999 }))).includes('durationMin')
    );
  });

  it('acepta color y precio', () => {
    const categoria = categoriaRules({ name: 'Mantenimiento', color: '#ff0000', precio: '35.50' });
    assert.equal(categoria.color, '#ff0000');
    assert.equal(categoria.precio, 35.5);
  });

  it('rechaza un color que no es hexadecimal', () => {
    assert.ok(
      camposDe(falla(() => categoriaRules({ name: 'Mantenimiento', color: 'azul' }))).includes('color')
    );
  });

  it('sin precio lo deja en null', () => {
    assert.equal(categoriaRules({ name: 'Mantenimiento' }).precio, null);
  });

  it('nace activa por defecto', () => {
    assert.equal(categoriaRules({ name: 'Mantenimiento' }).activo, true);
  });
});

describe('negocios', () => {
  const alta = {
    nombre: 'Clinica',
    slug: 'clinica',
    adminNombre: 'Laura',
    adminEmail: 'laura@ejemplo.com',
    adminPassword: 'Admin1234',
  };

  it('nace en UTC si no se dice que zona usa', () => {
    assert.equal(negocioRules(alta).timezone, 'UTC');
  });

  it('acepta una zona horaria valida', () => {
    assert.equal(negocioRules({ ...alta, timezone: 'America/Montevideo' }).timezone, 'America/Montevideo');
  });

  it('rechaza una zona que no existe', () => {
    assert.ok(
      camposDe(falla(() => negocioRules({ ...alta, timezone: 'America/Inventada' }))).includes('timezone')
    );
  });

  it('exige los datos del primer administrador', () => {
    for (const campo of ['adminNombre', 'adminEmail', 'adminPassword']) {
      assert.ok(camposDe(falla(() => negocioRules({ ...alta, [campo]: undefined }))).includes(campo), campo);
    }
  });

  it('el slug NO se puede cambiar al editar, y se dice por que', () => {
    /// Es la direccion publica de la empresa. Ignorarlo en silencio seria peor que
    /// rechazarlo: nadie se enteraria hasta que un enlace repartido dejara de abrir.
    const error = falla(() => negocioUpdate({ slug: 'otro-slug' }));
    assert.match(mensajeDe(error, 'slug'), /no se puede cambiar/);
  });

  it('rechaza una actualizacion que no cambia nada', () => {
    assert.match(falla(() => negocioUpdate({})).message, /ningun campo/);
  });

  it('acepta activar y desactivar', () => {
    assert.equal(negocioUpdate({ activo: false }).activo, false);
    assert.equal(negocioUpdate({ activo: true }).activo, true);
  });

  it('rechaza un activo que no es booleano', () => {
    assert.ok(camposDe(falla(() => negocioUpdate({ activo: 'si' }))).includes('activo'));
  });

  it('acepta el margen y la duracion por defecto de los bloques', () => {
    const datos = negocioUpdate({ bufferMin: 10, slotMinutes: 30 });
    assert.equal(datos.bufferMin, 10);
    assert.equal(datos.slotMinutes, 30);
  });
});

describe('usuarios del negocio', () => {
  it('por defecto crea un STAFF, no un ADMIN', () => {
    /// Lo que se necesita el 90% de las veces es "otro profesional que entre al
    /// panel", no "otro que pueda dar de baja a la gente".
    assert.equal(
      usuarioRules({ nombre: 'Dr Perez', email: 'p@ejemplo.com', password: 'Doctor1234' }).role,
      'STAFF'
    );
  });

  it('acepta ADMIN y CLIENT', () => {
    assert.equal(
      usuarioRules({ nombre: 'Laura', email: 'l@ejemplo.com', password: 'Admin1234', role: 'ADMIN' }).role,
      'ADMIN'
    );
    assert.equal(
      usuarioRules({ nombre: 'Ana', email: 'a@ejemplo.com', password: 'Cliente1234', role: 'CLIENT' }).role,
      'CLIENT'
    );
  });

  it('una empresa NO puede crear superadministradores', () => {
    /// El aislamiento por tenant seria decorativo si cualquiera pudiera manufacture
    /// un SUPERADMIN desde dentro de su empresa.
    assert.ok(
      camposDe(
        falla(() =>
          usuarioRules({
            nombre: 'Falso',
            email: 'f@ejemplo.com',
            password: 'Cliente1234',
            role: 'SUPERADMIN',
          })
        )
      ).includes('role')
    );
  });
});

describe('auth', () => {
  const ficha = {
    nombre: 'Ana Martinez',
    documento: '12345678',
    fechaNacimiento: '1990-04-12',
    email: 'ana@ejemplo.com',
    password: 'Cliente1234',
    confirmPassword: 'Cliente1234',
    negocio: 'ejemplo',
  };

  it('el registro exige el negocio', () => {
    assert.ok(camposDe(falla(() => registerRules({ ...ficha, negocio: undefined }))).includes('negocio'));
  });

  it('las contrasenas del registro tienen que coincidir', () => {
    const error = falla(() => registerRules({ ...ficha, confirmPassword: 'Otra1234' }));
    assert.deepEqual(camposDe(error), ['confirmPassword']);
    assert.match(mensajeDe(error, 'confirmPassword'), /no coinciden/);
  });

  it('el login no exige negocio: ese es el acceso de plataforma', () => {
    const sesion = loginRules({ email: 'super@plataforma.com', password: 'Super1234' });
    assert.equal(sesion.negocio, '');
  });

  it('el login acepta el negocio como businessSlug (el frontend viejo)', () => {
    const sesion = loginRules({ email: 'ana@ejemplo.com', password: 'Cliente1234', businessSlug: 'ejemplo' });
    assert.equal(sesion.negocio, 'ejemplo');
  });

  it('resetear exige token y contrasena nueva', () => {
    const reset = resetRules({ token: 'abc123', password: 'Nueva1234', confirmPassword: 'Nueva1234' });
    assert.equal(reset.token, 'abc123');
  });

  it('resetear rechaza contrasenas que no coinciden', () => {
    const error = falla(() =>
      resetRules({ token: 'abc', password: 'Nueva1234', confirmPassword: 'Otra1234' })
    );
    assert.match(mensajeDe(error, 'confirmPassword'), /no coinciden/);
  });

  it('cambiar la contrasena no puede ser dejar la misma', () => {
    /// Si no, el endpoint "cambiar la clave" acepta la clave actual, reinicia las
    /// sesiones y dice "contrasena actualizada" sin haber cambiado nada.
    const error = falla(() =>
      passwordRules({
        passwordActual: 'Cliente1234',
        passwordNueva: 'Cliente1234',
        confirmPassword: 'Cliente1234',
      })
    );

    assert.match(mensajeDe(error, 'passwordNueva'), /distinta/);
  });
});
