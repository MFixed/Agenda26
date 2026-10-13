import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, configurarSqlite } from '../config/driver.js';

/**
 * Integracion contra el esquema real.
 *
 * Estos tests SI abren Prisma (a diferencia del resto de la suite, que es unitaria):
 * comprueban que el esquema tiene lo que el codigo da por hecho. Son los que se
 * rompen cuando se anade una columna y se olvida moverla, o cuando el codigo pide una
 * relacion que el modelo no declara.
 *
 * La base es `prisma/test.db`, que `tests/setup.js` crea y aplica antes de nada.
 */

/** Columnas de cada tabla, leidas una vez antes de los tests que las necesitan. */
const columnas = new Map();

const TABLAS = [
  'WaitlistEntry',
  'Appointment',
  'User',
  'Reminder',
  'Availability',
  'Task',
  'Business',
  'Client',
  'BusinessSchedule',
];

const infoDe = async (tabla) => {
  const filas = await prisma.$queryRawUnsafe(`PRAGMA table_info('${tabla}')`);
  return filas;
};

before(async () => {
  await configurarSqlite();

  for (const tabla of TABLAS) {
    const info = await infoDe(tabla);
    columnas.set(tabla, { info, nombres: new Set(info.map((c) => c.name)) });
  }
});

after(async () => {
  await prisma.$disconnect();
});

describe('integridad de las reservas', () => {
  it('el indice que impide el doble booking existe', async () => {
    /*
     * El mas importante de todos.
     *
     * `Appointment_hueco_vivo_key` es un indice UNIQUE PARCIAL que Prisma no expresa
     * en `schema.prisma` (SQLite no los tiene), asi que vive solo en la migracion. No
     * lo ven ni `prisma validate` ni `migrate status`, y se puede perder sin que nada
     * avise: ahi la unica proteccion pasa a ser la comprobacion previa del service,
     * que es una lectura y por lo tanto no protege bajo concurrencia.
     *
     * Comprobandolo en cada ejecucion, un `migrate dev` que lo borra se ve en los
     * tests y no con dos clientes reservando el mismo bloque.
     */
    const indices = await prisma.$queryRaw`PRAGMA index_list('Appointment')`;
    const nombres = indices.map((i) => i.name);

    assert.ok(
      nombres.includes('Appointment_hueco_vivo_key'),
      `falta el indice anti-doble-booking. Indices: ${nombres.join(', ')}. Aplica las migraciones.`
    );
  });

  it('ese indice es UNIQUE y es PARCIAL', async () => {
    /// "Parcial" es lo que lo hace correcto: solo cubre las citas vivas, asi que una
    /// cita CANCELLED y otra nueva sobre el mismo hueco no chocan entre si.
    const indices = await prisma.$queryRaw`PRAGMA index_list('Appointment')`;
    const indice = indices.find((i) => i.name === 'Appointment_hueco_vivo_key');

    assert.ok(indice, 'no existe el indice');
    assert.equal(Number(indice.unique), 1, 'tiene que ser UNIQUE');
    assert.equal(Number(indice.partial), 1, 'tiene que ser PARCIAL');
  });

  it('el indice de huecos unicos por profesional tambien existe', async () => {
    /// `Availability_businessId_staffId_date_startTime_key` es un indice de EXPRESION
    /// (`COALESCE("staffId", 0)`) que permite huecos sin profesional sin duplicarlos y a
    /// la vez que dos profesionales distintos puedan tener bloque a la misma hora.
    const indices = await prisma.$queryRaw`PRAGMA index_list('Availability')`;
    const nombres = indices.map((i) => i.name);

    assert.ok(
      nombres.includes('Availability_businessId_staffId_date_startTime_key'),
      `falta el indice de huecos. Indices: ${nombres.join(', ')}`
    );
  });
});

describe('configuracion de la base', () => {
  it('las claves foraneas estan ACTIVAS', async () => {
    /*
     * En SQLite estan DESACTIVADAS por defecto, sin excepcion y sin aviso. Si el
     * PRAGMA se pierde (una reconexion), los `ON DELETE CASCADE` dejan de ejecutarse y
     * las filas huerfanas se acumulan en silencio.
     */
    const resultado = await prisma.$queryRaw`PRAGMA foreign_keys`;

    assert.equal(Number(resultado[0].foreign_keys), 1, 'foreign_keys deberia estar ON');
  });

  it('el modo WAL esta activo', async () => {
    /// Con el modo por defecto (delete), un lector bloquea al escritor y el panel se
    /// congela mientras alguien guarda.
    const resultado = await prisma.$queryRaw`PRAGMA journal_mode`;

    assert.equal(String(resultado[0].journal_mode).toLowerCase(), 'wal');
  });

  it('espera a un bloqueo en vez de fallar al instante', async () => {
    /// Con `busy_timeout = 0` (el valor de fabrica) la segunda escritura que llega
    /// mientras hay otra en curso falla con SQLITE_BUSY en lugar de esperar.
    const resultado = await prisma.$queryRaw`PRAGMA busy_timeout`;

    assert.ok(resultado[0].timeout >= 1000, `busy_timeout demasiado corto: ${resultado[0].timeout}`);
  });
});

describe('las relaciones que consulta el codigo existen', () => {
  it('WaitlistEntry tiene client y category, y NO staff', () => {
    /*
     * `waitlist.service.js` pedia `staff` en el `select` de `WaitlistEntry` y el modelo
     * no lo declara: el error era "Unknown field `staff` for select statement" y la
     * lista de espera entera daba 500 siempre.
     *
     * Aqui se fija la forma REAL, para que volver a pedir `staff` falle en los tests y
     * no en produccion.
     */
    const nombres = columnas.get('WaitlistEntry').nombres;

    assert.ok(nombres.has('clientId'), 'falta clientId');
    assert.ok(nombres.has('categoryId'), 'falta categoryId');
    assert.ok(nombres.has('staffId'), 'falta staffId como columna');
    assert.equal(
      nombres.has('staff'),
      false,
      'WaitlistEntry no declara relacion `staff`: pedirla en un select es un error'
    );
  });

  it('Appointment tiene todo lo que usa el service', () => {
    const nombres = columnas.get('Appointment').nombres;

    for (const esperada of ['availabilityId', 'clientId', 'taskId', 'staffId', 'cancelReason', 'version']) {
      assert.ok(nombres.has(esperada), `Appointment falta ${esperada}`);
    }
  });

  it('User tiene tokenVersion', () => {
    /// Sin esta columna, `authenticate` compararia `undefined` con `undefined` y daria
    /// por bueno cualquier token, con lo que "cerrar sesion" no expulsaria a nadie.
    assert.ok(columnas.get('User').nombres.has('tokenVersion'), 'User falta tokenVersion');
  });

  it('Reminder tiene todo lo que necesita el worker', () => {
    const nombres = columnas.get('Reminder').nombres;

    for (const esperada of ['appointmentId', 'status', 'scheduledFor', 'sentAt', 'attempts', 'lastError']) {
      assert.ok(nombres.has(esperada), `Reminder falta ${esperada}`);
    }
  });

  it('Business lleva la zona horaria, el buffer y la duracion', () => {
    /// Sin `timezone`, "hoy" se calcularia en la zona del servidor y una clinica en
    /// Montevideo veria el dia equivocado a partir de las 21:00.
    const nombres = columnas.get('Business').nombres;

    for (const esperada of ['timezone', 'bufferMin', 'slotMinutes']) {
      assert.ok(nombres.has(esperada), `Business falta ${esperada}`);
    }
  });
});

describe('las columnas por defecto son las que el codigo asume', () => {
  it('una retencion nace sin heldUntil ni heldById', () => {
    /*
     * Son nullables a proposito: solo un hueco retenido los tiene. Si se pusieran con
     * valor por defecto, todos los huecos libres parecerian retenidos y `expirarHolds`
     * no encontraria nunca uno caducado.
     */
    const info = columnas.get('Availability').info;
    const heldUntil = info.find((c) => c.name === 'heldUntil');
    const heldById = info.find((c) => c.name === 'heldById');

    assert.ok(heldUntil, 'falta heldUntil');
    assert.ok(heldById, 'falta heldById');
    assert.equal(Number(heldUntil.notnull), 0, 'heldUntil debe poder ser NULL');
    assert.equal(Number(heldById.notnull), 0, 'heldById debe poder ser NULL');
  });

  it('los ids de negocio son obligatorios donde la empresa es imprescindible', () => {
    /*
     * Un `businessId` nullable permitiria una cita huerfana, sin empresa, que el
     * middleware no encontraria al resolver el negocio pero que se queda en la base.
     *
     * `User` queda FUERA a proposito: su `businessId` es nullable porque el
     * SUPERADMIN gestiona la plataforma y no trabaja en ninguna empresa.
     */
    for (const tabla of [
      'Appointment',
      'Availability',
      'Task',
      'Client',
      'WaitlistEntry',
      'BusinessSchedule',
    ]) {
      assert.ok(columnas.has(tabla), `${tabla} no se leyo`);

      const businessId = columnas.get(tabla).info.find((c) => c.name === 'businessId');

      assert.ok(businessId, `${tabla} sin businessId`);
      assert.equal(Number(businessId.notnull), 1, `${tabla}.businessId deberia ser NOT NULL`);
    }
  });

  it('User.businessId es nullable porque el SUPERADMIN no pertenece a ninguna empresa', () => {
    /*
     * Es lo contrario de un descuido: si `User.businessId` fuera NOT NULL, no se podria
     * crear la cuenta de plataforma que es la unica que puede crear las demas, y el
     * sistema no tendria por donde empezar.
     */
    const businessId = columnas.get('User').info.find((c) => c.name === 'businessId');

    assert.ok(businessId, 'User sin businessId');
    assert.equal(Number(businessId.notnull), 0, 'User.businessId debe poder ser NULL (SUPERADMIN)');
  });
});
