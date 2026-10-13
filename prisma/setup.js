import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import 'dotenv/config';

/**
 * Deja la base de datos lista para empezar.
 *
 * Uso:
 *   npm run db:setup              (pregunta antes de BORRAR lo que haya)
 *   npm run db:setup -- --force   (borra sin preguntar)
 *   npm run db:setup -- --seed    (ademas mete los datos de ejemplo)
 *
 * Que hace, en este orden:
 *   1. Crea el fichero de base si no existe (no falla si ya esta).
 *   2. Aplica las migraciones pendientes.
 *   3. Borra TODOS los datos.
 *   4. Deja un unico superadministrador, que es con quien se entra la primera vez.
 *
 * Los pasos 3 y 4 juntos son `db:reset`. Se ejecutan aqui para que un solo comando
 * deje el sistema en un estado conocido, en vez de tener que acordarse de la
 * secuencia.
 *
 * Por que existe en vez de un `npm run db:reset` a secas: en desarrollo el fallo
 * tipico es cambiar el esquema, aplicar las migraciones y encontrarse con datos
 * viejos que ya no encajan. Un solo comando que parte de cero lo evita, y como
 * PIDE antes de borrar, no se lleva por sorpresa datos que de verdad querias.
 */

const raiz = resolve(import.meta.dirname, '..');
const conFuerza = process.argv.includes('--force');
const conSeed = process.argv.includes('--seed');

/**
 * Ruta real del fichero de SQLite, o `null` si no es SQLite.
 *
 * Los dos detalles que importan, y que antes estaban mal:
 *
 *  - Los parametros de la query NO son parte de la ruta. `file:./dev.db?connection_limit=1`
 *    se usaba tal cual como nombre de fichero, con el `?connection_limit=1` pegado,
 *    y `existsSync` de ahi siempre daba falso.
 *  - Prisma resuelve las rutas `file:` RELATIVAS a la carpeta del esquema, que es
 *    `prisma/`, no a la raiz del proyecto. Con `file:./dev.db`, la base esta en
 *    `prisma/dev.db`.
 *
 * Las dos juntas hacen que este script creyera que no habia base de datos NUNCA, y
 * como `forzarReset` salia de ahi, `npm run db:setup` borraba la base entera sin
 * llegar a preguntar. En un despliegue con datos reales, eso es perder las citas.
 *
 * Con ruta absoluta (`file:/var/lib/agenda26/app.db`) se respeta tal cual, que es
 * lo que se usa en produccion.
 */
function rutaDeSqlite(url) {
  if (!/^file:/i.test(url)) return null;

  /// Se separa la query: `?connection_limit=1` son parametros, no parte del nombre.
  const sinQuery = url.slice('file:'.length).split('?')[0].trim();

  if (sinQuery === '' || sinQuery === ':memory:') return null;

  return isAbsolute(sinQuery) ? sinQuery : resolve(raiz, 'prisma', sinQuery);
}

const ruta = rutaDeSqlite(process.env.DATABASE_URL?.trim() ?? '');

/**
 * Borra los ficheros de SQLite.
 *
 * No solo el `.db`: el modo WAL deja dos companions (`-wal` y `-shm`) con cambios
 * que todavia no se han volcado al fichero principal. Si se borra solo el `.db` y
 * quedan ellos, SQLite puede intentar recuperar transacciones a medias y la base
 * arranca en un estado raro. Los tres van juntos.
 */
function borrarFicheroBase() {
  if (!ruta || !existsSync(ruta)) return false;

  for (const sufijo of ['', '-wal', '-shm']) {
    rmSync(`${ruta}${sufijo}`, { force: true });
  }

  return true;
}

/**
 * Ejecuta el CLI de Prisma.
 *
 * `shell: true` no es un descuido: en Windows el ejecutable de una dependencia es
 * `prisma.cmd`, y `execFileSync('npx', ...)` falla con ENOENT porque no encuentra un
 * `npx` sin extension. Con shell, el sistema aplica el PATHEXT que toque.
 */
function prisma(args, etiqueta) {
  process.stdout.write(`  ${etiqueta}\n`);
  execFileSync(`npx ${args.join(' ')}`, { cwd: raiz, stdio: 'inherit', shell: true });
}

function correrNode(args, etiqueta) {
  process.stdout.write(`\n  ${etiqueta}\n`);
  execFileSync(process.execPath, args, { cwd: raiz, stdio: 'inherit' });
}

console.log('Preparando la base de datos...\n');
console.log(`  fichero: ${ruta ?? 'el que indique DATABASE_URL'}`);

const habiaBase = existsSync(ruta ?? '');

/*
 * `db:setup` RECONSTRUYE la base desde cero. Por eso no es un "se actualiza": es
 * un "se borra y se vuelve a hacer".
 *
 * Por lo tanto solo tiene sentido cuando la base esta vacia de verdad. En una
 * instalacion con datos, ejecutarlo es perderlos, y por eso:
 *
 *  1. Se PREGUNTA ANTES de borrar. Antes el borrado (`borrarFicheroBase`) ocurria
 *     en la linea 78 y la pregunta en la 93: cuando se llegaba a preguntar, el
 *     fichero ya estaba en el suelo. Se estaba preguntando por educacion.
 *  2. En PRODUCCION no se borra sin `--force` explicito, aunque alguien responda
 *     "si". `NODE_ENV=production` con datos de clientes reales necesita una
 *     decision consciente, no un "si" de teclado.
 */
const esProduccion = process.env.NODE_ENV === 'production';

if (habiaBase && !conFuerza) {
  const motivo = esProduccion ? '\n  ESTAS EN PRODUCCION. Esto borra TODOS los datos.\n' : '';
  const leido = await new Promise((resolver) => {
    process.stdout.write(`${motivo}\n  Se va a BORRAR todo lo que hay en la base. ¿Seguro? (SI/no) `);
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', resolver);
  });

  if (!/^si$/i.test(String(leido).trim())) {
    console.log('\n  Cancelado. No se ha tocado nada.\n');
    process.exit(0);
  }

  if (esProduccion && !process.argv.includes('--force')) {
    console.log('\n  En produccion hace falta --force ademas de confirmar. Cancelado.\n');
    process.exit(1);
  }
}

const borrado = borrarFicheroBase();

if (borrado) {
  console.log('\n  Base anterior eliminada (se recrea desde las migraciones).');
}

prisma(['prisma', 'migrate', 'deploy'], 'Aplicando migraciones...');

/*
 * `db:reset` deja solo el superadministrador.
 *
 * Cuando ya se ha preguntado y se ha contestado (o vino con `--force`), el reset
 * ya no necesita preguntar otra vez.
 */
correrNode(['prisma/reset.js', '--force'], 'Dejando solo el superadministrador...');

if (conSeed) {
  correrNode(['prisma/seed.js'], 'Cargando datos de ejemplo...');
}

console.log('\nListo. Arranca con: npm run dev\n');
