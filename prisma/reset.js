/**
 * Vacia la base de datos y deja solo el superadministrador.
 *
 * Uso:
 *   npm run db:reset              (pregunta antes de borrar)
 *   npm run db:reset -- --force   (borra sin preguntar)
 *
 * Para tener de vuelta los datos de ejemplo: `npm run db:seed`.
 *
 * v2 borra tambien lo que en v1 se quedaba ahi: refresh tokens, tokens de
 * recuperacion, recordatorios, lista de espera y auditoria. Sin ellos, tras un
 * reset quedan filas apuntando a usuarios que ya no existen.
 *
 * El borrado va en orden INVERSO al de las relaciones, porque las claves foraneas
 * no dejan borrar un padre que todavia tiene hijos. `deleteMany` en vez de
 * `delete`: en singular, Prisma exige un `where`, y un `{ id: { not: null } }` tan
 * solo para no escribirlo es ruido.
 *
 * SQLite: las claves foraneas estan DESACTIVADAS por defecto, asi que el orden
 * importa aqui igual que en PostgreSQL. No por la base, sino por lo que quiere decir
 * el sistema: borrar los hijos antes que los padres deja el historial limpio y hace
 * que el script siga siendo valido si algun dia se cambia de motor.
 */

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/utils/password.js';
import { prisma, configurarSqlite } from '../config/driver.js';

/// El cliente se importa del driver y NO se crea uno aqui.
///
/// Antes este archivo hacia `new PrismaClient()` y luego llamaba a
/// `configurarSqlite()`, que configura el cliente del driver. Eran dos conexiones
/// distintas: esta se quedaba con `busy_timeout = 0` y `foreign_keys = OFF`, con lo
/// que un `SQLITE_BUSY` salia al instante en vez de esperar, y los `ON DELETE
/// CASCADE` del esquema no se ejecutaban. El orden de borrado de `EN_CASCADA` era lo
/// unico que sujetaba la integridad.
await configurarSqlite();

/**
 * El superadministrador no pertenece a ninguna empresa: gestiona la plataforma, no
 * trabaja en ninguna. Por eso `businessId` va a null.
 *
 * La contrasena sale de `SUPERADMIN_PASSWORD`. Antes estaba fija en el archivo
 * (`Super1234`) y este script la imprimia por pantalla, con lo que un despliegue
 * desde CI dejaba la contrasa del administrador de la plataforma en un log
 * archivado. En produccion es obligatoria y hay que ponerla; en desarrollo, si no se
 * pone, se genera una aleatoria y se imprime una vez (que es lo unico que se puede
 * hacer con una clave que no se conoce de antemano).
 */
const SUPERADMIN_PASSWORD =
  process.env.SUPERADMIN_PASSWORD ||
  (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Falta SUPERADMIN_PASSWORD. En produccion es obligatoria: sin ella este script crearia una cuenta de plataforma con una contrasena fija.'
      );
    }

    return randomBytes(12).toString('base64url');
  })();

const SUPERADMIN = {
  nombre: 'Equipo Plataforma',
  email: process.env.SUPERADMIN_EMAIL || 'super@plataforma.com',
  password: SUPERADMIN_PASSWORD,
};

/**
 * Tablas de la mas dependiente a la menos.
 *
 * El orden importa y no es cosmetico: si `Appointment` se borrara despues de `Task`,
 * la primera se llevaria por delante las citas y el historial en cascada y el borrado
 * de `Task` no fallaria, pero el recuento final no seria el que dice el script.
 */
const EN_CASCADA = [
  'notification',
  'reminder',
  'waitlistEntry',
  'appointmentEvent',
  'appointment',
  'task',
  'availability',
  'businessSchedule',
  'clientProfile',
  'client',
  'category',
  'staff',
  'auditLog',
  'userSettings',
  'refreshToken',
  'passwordResetToken',
  'user',
  'businessSettings',
  'business',
];

/**
 * El superadministrador se respeta: es la cuenta con la que se entra despues de
 * vaciar, y borrarla solo para recrearla con otro id no aporta nada.
 *
 * Son dos filtros y tienen que decir lo mismo, pero en positivo y en negativo:
 * `borrar` dice a quien se lleva, `contar` a quien no. Confundirlas hacia que el
 * recuento anuncie "user 1" y el borrado respete la excepcion, y el script miente
 * sobre lo que va a hacer.
 */
const EXCEPTO = { user: { email: SUPERADMIN.email } };

const seBorra = (modelo) => (EXCEPTO[modelo] ? { NOT: EXCEPTO[modelo] } : {});

async function contar() {
  const tablas = await Promise.all(
    EN_CASCADA.map(async (modelo) => ({
      modelo,
      total: await prisma[modelo].count({ where: seBorra(modelo) }),
    }))
  );

  return tablas.filter((t) => t.total > 0);
}

async function confirmar() {
  if (process.argv.includes('--force')) return true;

  /// Sin terminal (CI, un `&&` encadenado) no hay a quien preguntar: sin `--force`
  /// se sale en vez de borrar lo que sea por sorpresa.
  if (!stdin.isTTY) {
    console.error(
      'Este script borra la base de datos. Anade --force para confirmar: npm run db:reset -- --force'
    );
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const respuesta = await rl.question(
    'Se borrara todo y solo quedara el superadministrador. Escribir SI para continuar: '
  );
  rl.close();

  return respuesta.trim().toUpperCase() === 'SI';
}

async function main() {
  const conDatos = await contar();

  if (conDatos.length > 0) {
    console.log('Lo que se va a borrar:');
    for (const { modelo, total } of conDatos) {
      console.log(`  ${modelo.padEnd(20)} ${total}`);
    }
  }

  if (!(await confirmar())) {
    console.log('Cancelado. No se borro nada.');
    return;
  }

  for (const modelo of EN_CASCADA) {
    await prisma[modelo].deleteMany({ where: seBorra(modelo) });
  }

  /*
   * `upsert` y no `create`: rodar el script dos veces no debe fallar con un correo
   * que ya existe. La contrasena no se toca en el `update`: si el superadministrador
   * ya esta y le han cambiado la clave, un reset no debería devolverle la de ejemplo
   * sin querer.
   */
  await prisma.user.upsert({
    where: { email: SUPERADMIN.email },
    update: { role: 'SUPERADMIN', businessId: null, activo: true, deletedAt: null },
    create: {
      nombre: SUPERADMIN.nombre,
      email: SUPERADMIN.email,
      passwordHash: await hashPassword(SUPERADMIN.password),
      role: 'SUPERADMIN',
      businessId: null,
    },
  });

  const negocios = await prisma.business.count();
  const usuarios = await prisma.user.count();

  console.log('\nBase vaciada.\n');
  console.log(`Base lista: ${negocios} negocio(s), ${usuarios} usuario(s).`);

  if (negocios === 0) {
    /// Decirlo es mejor que dejar a alguien buscando un /b/ de algo que ya no esta.
    console.log(
      '  No hay ninguna empresa: entra por /login con el superadministrador y crea la primera desde su panel.'
    );
  }

  console.log(`  superadministrador: ${SUPERADMIN.email}`);
  console.log('  Contrasena: la que haya puesto en SUPERADMIN_PASSWORD.');

  /*
   * En DESARROLLO se imprime, y solo si se ha generado aqui.
   *
   * Con `SUPERADMIN_PASSWORD` puesta no se muestra: quien la puso ya la sabe, y en
   * un despliegue desde CI esta salida queda en un log archivado que lee mucha mas
   * gente que el que ha hecho el despliegue.
   *
   * Cuando se genera aqui (sin `SUPERADMIN_PASSWORD` y sin `NODE_ENV=production`) no
   * hay otra forma de que nadie se entere: la clave es aleatoria y solo existe en
   * este momento. Se avisa de que conviene apuntarla antes de seguir.
   */
  if (!process.env.SUPERADMIN_PASSWORD) {
    console.log(`\n  Contrasena generada para esta vez: ${SUPERADMIN.password}`);
    console.log('  Apuntala: no se vuelve a mostrar y no hay forma de recuperarla.');
  }

  console.log('\n  Para los datos de ejemplo (empresa, equipo, clientes, agenda): npm run db:seed');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
