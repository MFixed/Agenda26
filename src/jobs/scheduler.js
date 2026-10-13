import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Planificador de tareas periodicas.
 *
 * v2 anade lo que en v1 no existia: nada se ejecutaba solo. Las retenciones de
 * hueco, los recordatorios y la purga de notificaciones dependen de un proceso que
 * pase cada cierto tiempo. Sin el, "retener un hueco 10 minutos" no expiraba nunca
 * y un bloque cancelado se quedaba apartado para siempre.
 *
 * Se usa un `setTimeout` encolado al final de cada ronda y no node-cron a
 * proposito: las tareas son "cada N minutos" y no "los lunes a las 9".
 *
 * Y se mide DESDE QUE TERMINA LA ANTERIOR, que es lo que evita que dos rondas se
 * solapen. Con `setInterval` no se evita nada: el temporizador dispara cada
 * `jobIntervalMs` haya terminado la ronda o no. Si enviar los recordatorios tarda
 * mas que el periodo (Resend lento, cien correos), la siguiente ronda arranca
 * encima de la que sigue corriendo, y como `programarPendientes` decide con un
 * `none: {}` que no habia ningun recordatorio y no hay indice unico que lo
 * respalde, se acaban creando avisos duplicados y el cliente recibe dos correos
 * de lo mismo.
 *
 * `unref()` es lo que permite cerrar el proceso con Ctrl+C: sin el, el timer
 * mantiene el event loop vivo y el apagado ordenado de `index.js` no terminaria
 * nunca.
 */
const tareas = new Map();
let temporizador = null;
let ejecutando = false;
let detenido = false;

/**
 * Promesa de la ronda que esta corriendo, o `null` si no hay ninguna.
 *
 * La usa `esperarJobs()` para que el cierre de `index.js` pueda esperar a que
 * termine antes de desconectar el pool.
 */
let rondaActual = null;

async function ejecutarTodas() {
  /// Cinturon adicional: si alguien llama a `ejecutarTodas` a mano mientras hay una
  /// ronda en curso, la segunda no arranca. El `setTimeout` encolado ya lo
  /// evita; esto cubre la llamada manual.
  if (ejecutando) {
    logger.debug('ronda saltada: ya habia una en curso');
    return rondaActual;
  }

  ejecutando = true;
  rondaActual = (async () => {
    for (const [nombre, fn] of tareas) {
      const inicio = Date.now();

      try {
        const resultado = await fn();
        const ms = Date.now() - inicio;

        /// Solo se registra si la tarea hizo algo. Un log cada minuto diciendo "0
        /// expirados" es ruido que tapa lo que si importa.
        if (resultado && Object.values(resultado).some((v) => typeof v === 'number' && v > 0)) {
          logger.info('tarea periodica', { tarea: nombre, ms, ...resultado });
        } else {
          logger.debug('tarea periodica', { tarea: nombre, ms });
        }
      } catch (error) {
        /// Una tarea que falla no debe parar las demas: un fallo de Resend al mandar
        /// recordatorios no puede impedir que expiren las retenciones.
        logger.error('la tarea periodica fallo', { tarea: nombre, error });
      }
    }
  })();

  try {
    await rondaActual;
  } finally {
    ejecutando = false;
    rondaActual = null;
    encolarSiguiente();
  }
}

/** Programa la siguiente ronda para cuando termine ESTA. */
function encolarSiguiente() {
  if (detenido || !env.jobsEnabled) {
    return;
  }

  temporizador = setTimeout(() => {
    void ejecutarTodas();
  }, env.jobIntervalMs);

  temporizador.unref();
}

export function registrarTarea(nombre, fn) {
  tareas.set(nombre, fn);
}

export function arrancarJobs() {
  if (!env.jobsEnabled) {
    logger.warn('jobs desactivados (JOBS_ENABLED=false)');
    return;
  }

  detenido = false;

  /// El primer paso no espera al intervalo completo: si no, un despliegue recien
  /// arrancado tarda hasta `JOB_INTERVAL_MS` en expirar la primera retencion.
  void ejecutarTodas();

  logger.info('jobs arrancados', {
    cada: `${Math.round(env.jobIntervalMs / 1000)}s`,
    tareas: [...tareas.keys()],
  });
}

export function pararJobs() {
  detenido = true;

  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
    logger.info('jobs detenidos');
  }
}

/**
 * Espera a que termine la ronda que este corriendo ahora.
 *
 * Se llama al cerrar, DESPUES de `pararJobs()`. Sin esto, cerrar el pool con una
 * ronda a medias (mandando correos de recordatorio, expirando retenciones) corta
 * las consultas por debajo y el error se pierde en un `catch` que solo loguea: se
 * apaga el servidor, se pierden esos trabajos y no hay ni una linea de aviso.
 *
 * El timeout es una red de seguridad para que un job colgado (una llamada a Resend
 * que no responde) no impida el apagado.
 */
export async function esperarJobs(ms = 10_000) {
  if (!ejecutando || !rondaActual) {
    return true;
  }

  let temporizadorEspera = null;

  const seTermino = await Promise.race([
    rondaActual.then(
      () => true,
      () => true
    ),
    new Promise((resolver) => {
      temporizadorEspera = setTimeout(() => {
        logger.warn('la ronda de tareas no ha terminado a tiempo; se sigue cerrando');
        resolver(false);
      }, ms);

      /// Este temporizador no debe mantener vivo al proceso por si solo.
      temporizadorEspera.unref?.();
    }),
  ]);

  if (temporizadorEspera) {
    clearTimeout(temporizadorEspera);
  }

  return seTermino;
}

export default { registrarTarea, arrancarJobs, pararJobs, esperarJobs };
