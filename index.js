import { createApp } from './src/server.js';
import { env } from './config/env.js';
import { prisma, configurarSqlite, verificarEsquema } from './config/driver.js';
import { logger } from './config/logger.js';
import { arrancarJobs, pararJobs, esperarJobs } from './src/jobs/scheduler.js';
import './src/jobs/index.js';

/**
 * Se configura la base ANTES de crear la aplicacion.
 *
 * Los PRAGMAs tienen que estar puestos antes de la primera peticion: sin
 * `foreign_keys = ON` una escritura ya habria pasado sin comprobar sus claves
 * foraneas, y sin WAL el primer guardado bloquearia a todos los lectores.
 */
await configurarSqlite();

/*
 * El esquema se COMPRUEBA, no se supone.
 *
 * Sin esto, un despliegue recien arrancado responde 200 en `/api/health` (porque
 * `SELECT 1` contra una base sin tablas funciona) y el balanceador lo da por
 * bueno. La primera peticion real es la que revienta con "table Business does not
 * exist", y ya hay un cliente esperando.
 *
 * Se comprueba tambien el indice UNIQUE PARCIAL: Prisma no lo ve (SQLite no tiene
 * indices parciales en el esquema) asi que podria haberse perdido sin que `migrate
 * status` se entere, y sin el dos clientes reservan el mismo bloque.
 *
 * Fallar aqui es lo correcto: es mejor no arrancar que arrancar sirviendo 500.
 */
try {
  await verificarEsquema();
  logger.info('esquema verificado');
} catch (error) {
  logger.error('el esquema de la base no esta listo', { error: error.message });
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info('API escuchando', {
    url: env.appUrl,
    env: env.env,
    motor: env.databaseProvider,
    docs: env.docsEnabled ? `${env.appUrl}/api/docs` : null,
    jobs: env.jobsEnabled,
  });
});

server.on('error', (err) => {
  /*
   * Cualquier error del servidor de escucha es FATAL, y se distinguen los que se
   * pueden explicar para que el log diga algo util.
   *
   * Antes solo se miraba `EADDRINUSE` y el resto se relanzaba con `throw` DENTRO
   * de este manejador. Ese `throw` es una excepcion sin capturar que lleva al
   * proceso a salir con codigo 0, con lo que un orquestador con "reiniciar si
   * falla" NO lo reinicia y se queda sin servicio.
   */
  const explicacion = {
    EADDRINUSE: ['el puerto ya esta en uso', { puerto: env.port }],
    EACCES: [
      'permiso denegado al abrir el puerto (si es menor de 1024 hace falta root)',
      { puerto: env.port },
    ],
    EMFILE: ['se acabaron los descriptores de fichero', {}],
    ENFILE: ['el sistema se ha quedado sin descriptores de fichero', {}],
  };

  const [mensaje, extra] = explicacion[err.code] ?? [null, {}];

  if (mensaje) {
    logger.error(`el servidor no pudo arrancar: ${mensaje}`, { ...extra, codigo: err.code });
  } else {
    logger.error('el servidor no pudo arrancar', { codigo: err.code, error: err });
  }

  process.exit(1);
});

arrancarJobs();

/**
 * Cierre ordenado.
 *
 * El orden importa y es el inverso al de arranque:
 *
 *  1. Se deja de aceptar conexiones. Si no, mientras se cierra el pool entran
 *     peticiones nuevas que van a fallar contra una base que ya se esta apagando.
 *  2. Se paran los jobs, para que no empiecen una consulta contra un pool cerrado.
 *  3. Se cierra el pool.
 *  4. Sale.
 *
 * El `setTimeout` de seguridad esta porque `server.close()` espera a que terminen las
 * conexiones abiertas, y una conexion que se queda colgada (un cliente con una
 * descarga a medias) dejaria el proceso vivo para siempre. El orchestrator da su
 * margen y se va.
 */
let cerrando = false;

async function cerrar(signal, codigo = 0) {
  if (cerrando) return;

  cerrando = true;
  logger.info('cerrando', { signal });

  /// Se espera a que termine la ronda de jobs que este corriendo.
  ///
  /// `pararJobs()` solo limpia el temporizador de la PROXIMA ronda: si ahora mismo
  /// hay una en curso (enviando recordatorios, expirando retenciones), y se cierra
  /// el pool debajo de ella, su error se pierde en el log y se ha perdido trabajo
  /// a medias sin que nadie se entere. Retenciones que no expiran, avisos que no
  /// salen.
  await esperarJobs(env.shutdownTimeoutMs);

  const salida = () => {
    pararJobs();

    prisma
      .$disconnect()
      .then(() => {
        logger.info('cerrado limpiamente');
        process.exit(codigo);
      })
      .catch((error) => {
        logger.error('no se pudo cerrar el pool de la base', { error });
        process.exit(1);
      });
  };

  server.close(salida);

  setTimeout(() => {
    logger.warn('cierre forzado: alguna conexion no termino a tiempo');
    salida();
  }, env.shutdownTimeoutMs).unref();
}

/*
 * `SIGHUP` tambien. En un despliegue es la senal de recarga del supervisor, y sin
 * este manejador el proceso muere sin cerrar el pool ni parar los jobs: SQLite se
 * queda con el WAL a medias y las retenciones se quedan retenidas.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => cerrar(signal));
}

/*
 * `stdout` roto no puede matar el proceso.
 *
 * Cuando la salida estandar es una tuberia (un recolector de logs, `docker logs`,
 * `nohup`) y el otro extremo se cierra, `process.stdout.write` NO lanza: emite un
 * evento `'error'` asincrono. Sin este manejador, ese evento era una excepcion sin
 * capturar que se llevaba el proceso entero. El `try/catch` de `logger.escribir` no
 * cubria este caso, que es justo el que ocurre en produccion.
 */
for (const flujo of [process.stdout, process.stderr]) {
  flujo.on('error', (error) => {
    /// Sin stderr tampoco se puede avisar. Lo unico que se puede hacer es no morir.
    if (flujo === process.stderr) return;
    logger.warn('salida estandar no disponible', { error: error?.message });
  });
}

/*
 * Una promesa rechazada sin capturar SALE.
 *
 * Antes solo se logueaba y el proceso seguia. Eso deja el proceso en un estado
 * que nadie sabe que es: una escritura a medias, un `await` que se quedo sin hacer,
 * una promesa que nadie fue a recoger. El manejador de abajo (excepcion sin
 * capturar) si sale, y es raro que uno salga y el otro no: lo normal es que el
 * rechazo llegue primero.
 */
process.on('unhandledRejection', (razon) => {
  logger.error('promesa rechazada sin capturar', { error: razon });
  cerrar('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.error('excepcion sin capturar', { error });
  /// El proceso esta en un estado que no se sabe cual es. Se loguea y se sale: es lo
  /// unico responsable. Seguir vivo con el estado corrupto solo convierte un fallo
  /// visible en datos corruptos.
  ///
  /// Se sale con codigo 1 y no con 0: un orquestador con "reiniciar si falla" solo
  /// reinicia cuando el codigo NO es cero. Salir con 0 aqui hacia que la instancia
  /// rota se quedara sin sustituir.
  cerrar('uncaughtException', 1);
});
