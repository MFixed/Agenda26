/**
 * Copia de seguridad de la base de datos SQLite.
 *
 * Por que hace falta un script y no basta con copiar el fichero a mano:
 *
 * Con el modo WAL hay TRES ficheros que importan: el `.db`, el `-wal` y el `-shm`. En
 * el `-wal` queda lo que se ha escrito pero aun no se ha volcado al fichero
 * principal. Copiar solo el `.db` deja fuera esas transacciones sin avisar: la
 * copia parece correcta y le faltan las citas de los ultimos minutos.
 *
 * Se usa `VACUUM INTO`, que escribe una copia CONSISTENTE desde dentro del motor,
 * leyendo el `.db` y el `-wal` a la vez y sin bloquear a nadie. Es la unica forma
 * de copiar una base en WAL sin parar la aplicacion.
 *
 * Uso:
 *   npm run db:backup                    -> backup/prisma-<fecha>.db
 *   npm run db:backup -- /mi/destino.db   -> en esa ruta
 */
import { mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/driver.js';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ruta del fichero de SQLite, con la misma logica que `config/driver.js`. */
function rutaDeSqlite(url) {
  if (!/^file:/i.test(url ?? '')) return null;

  /// Se separa la query: `?connection_limit=1` son parametros, no parte del nombre.
  const sinQuery = url.slice('file:'.length).split('?')[0].trim();
  if (sinQuery === '' || sinQuery === ':memory:') return null;

  return isAbsolute(sinQuery) ? sinQuery : resolve(raiz, 'prisma', sinQuery);
}

const url = process.env.DATABASE_URL ?? 'file:./dev.db?connection_limit=1';
const origen = rutaDeSqlite(url);

if (!origen) {
  process.stderr.write('Este script solo trabaja con SQLite (DATABASE_URL file:...).\n');
  process.exit(1);
}

if (!existsSync(origen)) {
  process.stderr.write(`La base no existe todavia: ${origen}\n`);
  process.exit(1);
}

/* Destino: el que se pase por argumento, o una carpeta `backup/` con fecha. */
const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destino = process.argv[2] ? resolve(process.argv[2]) : resolve(raiz, 'backup', `prisma-${marca}.db`);

mkdirSync(dirname(destino), { recursive: true });

/*
 * `VACUUM INTO` exige que el destino NO exista, y falla si ya esta. Por eso se
 * quita antes: sin esto, dos ejecuciones en el mismo segundo (un cron que se
 * solapa, o dos maquinas) dejan la segunda sin hacer nada.
 */
if (existsSync(destino)) {
  for (const sufijo of ['', '-wal', '-shm']) {
    unlinkSync(`${destino}${sufijo}`);
  }
}

process.stdout.write(`Copia de seguridad en curso\n  origen:  ${origen}\n  destino: ${destino}\n`);

try {
  /// `VACUUM INTO` no acepta parametros vinculados: la ruta va en el texto de la
  /// sentencia. Se escapan las comillas simples, que es lo unico que podria
  /// cortocircuitar la sentencia, porque la ruta viene del entorno y no de fuera.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
} catch (error) {
  process.stderr.write(`\nNo se pudo hacer la copia: ${error.message}\n`);
  await prisma.$disconnect();
  process.exit(1);
}

if (!existsSync(destino)) {
  process.stderr.write('\nLa copia no se ha creado. Revisa los permisos de la carpeta de destino.\n');
  await prisma.$disconnect();
  process.exit(1);
}

const kb = Math.round(statSync(destino).size / 1024);
process.stdout.write(`\nHecha: ${destino} (${kb} KB)\n`);

/*
 * Limpieza: se conservan las N copias mas recientes y se borra el resto.
 *
 * Una copia que se acumula sin limite acaba llenando el disco, y un disco lleno
 * hace que SQLite no pueda escribir: el fallo aparece como "database is locked" en
 * la aplicacion, no como un problema de disco, que es mucho mas dificil de
 * diagnosticar.
 */
const MAX_COPIAS = 10;

try {
  const antiguas = readdirSync(dirname(destino))
    .filter((nombre) => nombre.startsWith('prisma-') && nombre.endsWith('.db'))
    .sort()
    .reverse();

  for (const vieja of antiguas.slice(MAX_COPIAS)) {
    for (const sufijo of ['', '-wal', '-shm']) {
      unlinkSync(join(dirname(destino), `${vieja}${sufijo}`));
    }
    process.stdout.write(`  (copia antigua borrada: ${vieja})\n`);
  }
} catch {
  /* Limpiar es lo de menos: si falla, la copia esta hecha y no pasa nada. */
}

await prisma.$disconnect();
process.exit(0);
