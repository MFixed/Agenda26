/**
 * Vacia la base de datos y deja solo el superadministrador.
 *
 * Uso:
 *   npm run db:reset              (pregunta antes de borrar)
 *   npm run db:reset -- --force   (borra sin preguntar)
 *
 * Para tener de vuelta los datos de ejemplo (negocio, admin, cliente, agenda):
 *   npm run seed
 *
 * El borrado va en orden inverso al de las relaciones, porque las claves
 * foraneas no dejan borrar un padre que todavia tiene hijos. `deleteMany` en vez
 * de `delete`: en singular, Prisma exige un `where`, y un `{ id: { not: null } }`
 * tan solo para no escribirlo es ruido.
 */

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';

const prisma = new PrismaClient();

/**
 * El superadministrador no pertenece a ninguna empresa: gestiona la plataforma,
 * no trabaja en ninguna. Por eso `businessId` va a null, igual que en el seed.
 */
const SUPERADMIN = {
  nombre: 'Equipo Plataforma',
  email: 'super@plataforma.com',
  password: 'Super1234',
};

/**
 * Tablas de la mas dependiente a la menos. Si `Appointment` se borrara despues
 * de `Task`, la primera se llevaria por delante las citas y el historial en
 * cascada y el borrado de `Task` no fallaria, pero el recuento final no seria el
 * que dice el script. En este orden cada tabla se borra cuando ya no tiene
 * quien la referencia.
 */
const EN_CASCADA = [
  'notification',
  'appointmentEvent',
  'appointment',
  'task',
  'availability',
  'client',
  'category',
  'user',
  'business',
];

/**
 * El superadministrador se respeta: es la cuenta con la que se entra despues de
 * vaciar, y borrarla solo para recrearla con otro id no aporta nada.
 *
 * Son dos filtros y tienen que decir lo mismo, pero en positivo y en negativo:
 * `borrar` dice a quien se lleva, `contar` a quien no. Confundirlos hacia que
 * el recuento anuncie "user 1" y el borrado respete la excepcion, y el script
 * miente sobre lo que va a hacer.
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
  if (process.argv.includes('--force')) {
    return true;
  }

  // Sin terminal (CI, un `&&` encadenado) no hay a quien preguntar: sin
  // `--force` se sale en vez de borrar lo que sea por sorpresa.
  if (!stdin.isTTY) {
    console.error('Este script borra la base de datos. Anade --force para confirmar: npm run db:reset -- --force');
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const respuesta = await rl.question('Se borrara todo y solo quedara el superadministrador. Escribir SI para continuar: ');
  rl.close();

  return respuesta.trim().toUpperCase() === 'SI';
}

async function main() {
  const conDatos = await contar();

  if (conDatos.length === 0) {
    console.log('La base ya esta vacia.');
  } else {
    console.log('Lo que se va a borrar:');
    for (const { modelo, total } of conDatos) {
      console.log(`  ${modelo.padEnd(20)} ${total}`);
    }

    if (!(await confirmar())) {
      console.log('Cancelado. No se borro nada.');
      return;
    }

    for (const modelo of EN_CASCADA) {
      await prisma[modelo].deleteMany({ where: seBorra(modelo) });
    }

    console.log('Base vaciada.');
  }

  // `upsert` y no `create`: rodar el script dos veces no debe fallar por un
  // correo que ya existe. La contrasena no se toca en el `update`: si el
  // superadministrador ya esta y le han cambiado la clave, un reset no deberia
  // devolverle la de ejemplo sin querer.
  await prisma.user.upsert({
    where: { email: SUPERADMIN.email },
    update: { role: 'SUPERADMIN', businessId: null, activo: true },
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

  console.log('');
  console.log(`Base lista: ${negocios} negocio(s), ${usuarios} usuario(s).`);

  if (negocios === 0) {
    // Sin empresas no hay puertas por las que entrar mas alla de la plataforma.
    // Decirlo es mejor que dejar a alguien buscando un /b/ de algo que ya no esta.
    console.log('  No hay ninguna empresa: entra por /login con el superadministrador y crea la primera desde su panel.');
  }

  console.log(`  superadministrador: ${SUPERADMIN.email} / ${SUPERADMIN.password}  ->  http://localhost:3000/login`);
  console.log('  Para los datos de ejemplo (empresa, administrador, cliente, agenda): npm run seed');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());