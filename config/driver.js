import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

/// Leido aqui para no repetir el parseo de entero que ya hace `env.js`.
const int = (valor, porDefecto, { min = -Infinity, max = Infinity } = {}) => {
  if (valor === undefined || valor === null || String(valor).trim() === '') return porDefecto;
  const n = Number(String(valor).trim());
  if (!Number.isInteger(n)) return porDefecto;
  return Math.min(Math.max(n, min), max);
};

/**
 * Instancia unica del cliente de ORM.
 *
 * Tres cosas se resuelven aqui y en ningun otro sitio:
 *
 *  1. Una sola instancia. Express recarga los modulos en modo --watch y un cliente
 *     por recarga abriria demasiadas conexiones hasta agotarlas.
 *  2. Logging segun entorno. En desarrollo se quieren los avisos de Prisma; en
 *     produccion solo errores.
 *  3. PRAGMAs de SQLite, que se verifican al arrancar en lugar de confiar en que
 *     estan puestos.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['error'] : ['warn', 'error'],
  });

globalForPrisma.prisma = prisma;

/**
 * Configuracion de SQLite.
 *
 * SQLite tiene un solo escritor: si dos conexiones intentan escribir a la vez, la
 * segunda recibe `SQLITE_BUSY` y Prisma lanza `P1008`. Los PRAGMAs son lo que evita
 * que eso aparezca en desarrollo, donde el watcher de `--watch` y el worker de jobs
 * escriben a la vez con total legitimidad.
 *
 *  - `journal_mode = WAL`: permite lectores y un escritor simultaneos. Sin esto, leer
 *    bloquea la escritura y el panel se congela mientras se guarda algo. WAL es
 *    persistente: se escribe una vez y se queda.
 *
 *  - `busy_timeout = 5000`: si hay un bloqueo, se espera 5 segundos en vez de fallar
 *    al instante. Es la diferencia entre "el panel se Slowa un segundo" y "la
 *    reserva de cita falla con un error que el usuario no entiende".
 *
 *  - `synchronous = NORMAL`: con WAL es la combinacion recomendada. FULL (el default)
 *    hace un fsync en cada commit, que en un portatilSSD se nota; NORMAL sacrifica
 *    como mucho la ULTIMA transaccion si la maquina se apaga de golpe, y la anterior
 *    sigue a salvo.
 *
 *  - `foreign_keys = ON`: en SQLite las claves foraneas estan DESACTIVADAS por
 *    defecto, sin excepcion y sin aviso. Sin este PRAGMA los `ON DELETE CASCADE` del
 *    esquema no hacen nada y las filas huerfanas se acumulan en silencio. Es el PRAGMA
 *    que mas caro sale olvidar.
 *
 * Por que el servidor va con UNA sola conexion (`connection_limit=1` en
 * `DATABASE_URL`): SQLite serializa las escrituras de todos modos, y con una sola
 * conexion no hay ni bloqueos ni esperas. En un despliegue real habria que poner
 * WAL y subir el limite; aqui no tiene sentido.
 */
export async function configurarSqlite() {
  if (env.databaseProvider !== 'sqlite') return;

  /*
   * `$queryRawUnsafe` y no `$executeRawUnsafe`, para TODOS.
   *
   * SQLite responde a los cuatro PRAGMAs con una fila (el valor resultante), y
   * Prisma separa `execute` (no devuelve filas) de `query` (las devuelve). Ejecutar
   * un PRAGMA con `execute` falla con `P2010: Execute returned results, which is
   * not allowed in SQLite`. Con `query` da igual que la fila exista o no.
   *
   * `journal_mode = WAL` devuelve la fila "wal", que es ademas la confirmacion de
   * que se aplico. Si el fichero estuviera en un sistema de archivos que no lo
   * soporta (una carpeta de red), se quedaria en "delete" y conviene enterarse.
   */
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);

  /*
   * `synchronous = NORMAL` en desarrollo y `FULL` en produccion.
   *
   * Con WAL, NORMAL sacrifica como mucho la ULTIMA transaccion si la maquina se
   * apaga de golpe: la anterior sigue a salvo. En un portatil es la combinacion
   * correcta. En un servidor NO: ahi un cliente puede recibir un `201 Created` de
   * una reserva y, si la maquina suffers un corte, encontrarse con que la cita no
   * existe. FULL hace un fsync en cada commit; cuesta algo mas, y es el precio de
   * poder decir que lo que se contesto esta escrito.
   *
   * Se deja configurable con `SQLITE_SYNCHRONOUS` para quien sepa lo que hace (por
   * ejemplo `OFF` para una base de pruebas que se puede tirar).
   */
  const synchronous = process.env.SQLITE_SYNCHRONOUS || (env.isProduction ? 'FULL' : 'NORMAL');
  await prisma.$queryRawUnsafe(`PRAGMA synchronous = ${synchronous};`);
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');

  logger.info('SQLite configurado', {
    journal: 'WAL',
    busyTimeout: BUSY_TIMEOUT_MS,
    synchronous,
    foreignKeys: true,
  });
}

const BUSY_TIMEOUT_MS = int(process.env.SQLITE_BUSY_TIMEOUT_MS, 5_000, { min: 0, max: 60_000 });

/**
 * Vuelve a poner los PRAGMAS despues de una reconexion.
 *
 * `journal_mode = WAL` es el unico que se persiste en la cabecera del fichero.
 * `busy_timeout`, `synchronous` y `foreign_keys` son estado POR CONEXION: cuando el
 * motor de Prisma se reinicia (despues de un fallo, de un despliegue, de que se
 * quede sin memoria) abre una conexion nueva con TODOS esos valores de fabrica.
 *
 * Y el de `foreign_keys` es el caro: en SQLite estan DESACTIVADOS por defecto sin
 * exception y sin aviso, asi que tras un reinicio los `ON DELETE CASCADE` dejan de
 * ejecutarse y las filas huerfanas se acumulan en silencio, sin un solo error que
 * lo delate. Ahi se llama desde el manejador de error de Prisma, que es cuando se
 * sabe que la conexion se ha ido.
 */
async function reaplicarPragmas() {
  try {
    await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
    logger.debug('PRAGMAs reaplicados tras reconectar');
  } catch (error) {
    /// Si esto falla, el siguiente `ping` lo dira tambien. No se enmascara el error
    /// original con el de este reintento.
    logger.warn('no se pudieron reaplicar los PRAGMAs', { error: error.message });
  }
}

if (env.databaseProvider === 'sqlite') {
  prisma.$on('error', (evento) => {
    const mensaje = String(evento?.target?.error?.message ?? evento?.message ?? '');

    /// Los errores de conexion son los que dejan una conexion en mal estado. Un
    /// `P1002` de "la base esta ocupada" es de consulta y no deja nada roto.
    const esDeConexion = /Connection|closed|timed out|SQLITE_CANTOPEN|ECONNREFUSED/i.test(mensaje);

    if (esDeConexion) {
      void reaplicarPragmas();
    }
  });
}

/**
 * Comprobacion de vida de la base. La usa /api/ready.
 *
 * `SELECT 1` a proposito: lo que se quiere saber es "hay alguien contestando", no si
 * las tablas existen. Si el esquema faltara, eso lo dice `verificarEsquema`, que se
 * ejecuta al arrancar.
 */
export async function ping() {
  const inicio = process.hrtime.bigint();
  await prisma.$queryRaw`SELECT 1`;
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  return { ok: true, latenciaMs: Math.round(ms * 100) / 100 };
}

/**
 * Comprueba que el esquema esta aplicado.
 *
 * Sin esto, un despliegue recien arrancado responde `200` en `/api/health` y
 * `/api/ready` (porque `SELECT 1` contra una base vacia funciona), el balanceador lo
 * da por bueno, y la PRIMERA peticion real recibe un 500 con "table Business does
 * not exist". El despliegue parece bueno hasta que llega un cliente.
 *
 * Se comprueba contra `_prisma_migrations`, que es la tabla que `migrate deploy`
 * crea y mantiene. Si no existe, es que las migraciones no se han aplicado.
 */
export async function verificarEsquema() {
  const tablas = await prisma.$queryRaw`PRAGMA table_info('Appointment')`;

  if (tablas.length === 0) {
    throw new Error(
      'El esquema no esta aplicado: falta la tabla "Appointment". Ejecuta `npm run db:migrate` antes de arrancar.'
    );
  }

  /// El indice parcial que impide el doble booking no lo ve Prisma, asi que
  /// tampoco sale del esquema. Si ha desaparecido (un `migrate dev` mal hecho), dos
  /// clientes pueden reservar el mismo bloque y no hay ningun indice que lo impida.
  const indices = await prisma.$queryRaw`PRAGMA index_list('Appointment')`;
  const nombres = indices.map((i) => i.name);

  if (!nombres.includes('Appointment_hueco_vivo_key')) {
    throw new Error(
      'Falta el indice "Appointment_hueco_vivo_key" (el que impide el doble booking). Aplica las migraciones: `npm run db:migrate`.'
    );
  }

  return { ok: true, tablas: tablas.length, indiceDobleReserva: true };
}

export default prisma;
