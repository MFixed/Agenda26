import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

/**
 * Logger estructurado.
 *
 * Sustituye a los `console.log` sueltos por una sola linea por evento, con los
 * mismos campos en todos los sitios. Dos cosas aporta frente a imprimir texto:
 *
 *  - Un `requestId` en cada linea. Sin el, cuando hay dos peticiones a la vez
 *    los logs se entrelazan y no hay forma de saber quais pertenecen a cual.
 *  - Salida JSON en produccion. Un agregador los indexa sin tener que adivinar
 *    el formato, y `LOG_LEVEL=debug` filtra sin tocar el codigo.
 *
 * Los niveles por debajo del configurado no se construyen nunca: el `if` esta
 * antes del `JSON.stringify`, que en la ruta caliente de cada peticion no es
 * gratis.
 */

const NIVELES = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

/*
 * El nivel sale de `env.logLevel`, no de `process.env` a pelo.
 *
 * Leyendolo directo, con `LOG_LEVEL` sin definir caia en el `'debug'` por defecto
 * tambien en produccion, y `config/env.js` lo que hace en produccion es poner
 * `info`. Con la lectura directa, una instancia de produccion sin la variable
 * escribia todo el `debug` y el `trace` al agregador de logs.
 */
const MINIMO = NIVELES[env.logLevel] ?? NIVELES.info;

/**
 * Lo que nunca debe salir en un log. No es paranoia: `passwordHash`,
 * `tokenVersion` y los tokens en claro son justo lo que se cuela al pasar un
 * objeto entero a un logger.
 *
 * `passwordTemporal` entra aqui por un motivo concreto: es la clave con la que
 * el alta de un usuario devuelve una contrasena GENERADA EN CLARO
 * (`user.service.js`, `client.service.js`). Sin este nombre en la lista, un
 * `logger.info('alta', respuesta)` —que parece inocuo— escribe al disco una
 * contrasena con la que se puede entrar.
 */
const SENSIBLES = new Set([
  'passwordHash',
  'password',
  'passwordActual',
  'passwordNueva',
  'passwordTemporal',
  'passwordTemporalHash',
  'clave',
  'token',
  'refreshToken',
  'accessToken',
  'tokenHash',
  'authorization',
  'tokenVersion',
  'secret',
  'apiKey',
]);

/**
 * Copia un objeto sin secretos, sin reventar nunca.
 *
 * Dos guarding que antes faltaban:
 *
 *  - Los CICLOS. Sin un conjunto de visitados, un objeto que se referencia a si
 *    mismo hacia que `JSON.stringify(linea)` lanzara "Converting circular structure
 *    to JSON" DESDE DENTRO del logger. Un log nunca debe tumbar la peticion que
 *    lo理学: un `req.log.error` con un contexto mal construido se convertia en un
 *    500.
 *  - Los `Date`. `typeof Date` es `'object'`, no es Error ni Array, asi que
 *    `Object.entries(unaFecha)` es `[]` y toda marca de tiempo salia como `{}`.
 */
function sinSecretos(objeto, profundidad = 0, vistos = new WeakSet()) {
  if (profundidad > 6) return '[demasiado profundo]';
  if (objeto === null || objeto === undefined) return objeto;

  /// Primitivas: se devuelven tal cual, sin inspeccionar.
  if (typeof objeto !== 'object') return objeto;

  /// Una fecha es un objeto sin propiedades enumerables: sin esta rama sale `{}`.
  if (objeto instanceof Date) {
    return Number.isNaN(objeto.getTime()) ? '[fecha invalida]' : objeto.toISOString();
  }

  if (objeto instanceof Error) {
    return {
      name: objeto.name,
      message: objeto.message,
      ...(objeto.code ? { code: objeto.code } : {}),
      ...(objeto.stack ? { stack: objeto.stack } : {}),
    };
  }

  /// Ciclo: se marca y no se vuelve a entrar. `WeakSet` solo vive durante esta
  /// llamada, asi que dos objetos iguales en ramas distintas no se confunden.
  if (vistos.has(objeto)) {
    return '[circular]';
  }
  vistos.add(objeto);

  if (Array.isArray(objeto)) {
    return objeto.map((item) => sinSecretos(item, profundidad + 1, vistos));
  }

  if (objeto instanceof Map) {
    return Object.fromEntries(
      [...objeto.entries()].map(([clave, valor]) => [
        String(clave),
        sinSecretos(valor, profundidad + 1, vistos),
      ])
    );
  }

  if (objeto instanceof Set) {
    return [...objeto].map((item) => sinSecretos(item, profundidad + 1, vistos));
  }

  return Object.fromEntries(
    Object.entries(objeto).map(([clave, valor]) => [
      clave,
      SENSIBLES.has(clave) ? '[oculto]' : sinSecretos(valor, profundidad + 1, vistos),
    ])
  );
}

function emitir(nivel, mensaje, contexto = {}) {
  if (NIVELES[nivel] > MINIMO) return;

  /*
   * Un logger que lanza es peor que no tener logger.
   *
   * Todo lo que va al log viene de fuera: un contexto con referencias cruzadas,
   * un getter que revienta, un `toJSON` lanzando. Si eso se propaga, la linea que
   * queria registrar un 500 se convierte en otro 500, y encima en un sitio donde
   * nadie va a mirar. Se construye la linea a prueba de fallos y, si aun asi
   * falla, se sale por `write` y ya.
   */
  let linea;

  try {
    linea = {
      ts: new Date().toISOString(),
      nivel,
      msg: mensaje,
      ...sinSecretos(contexto),
    };
  } catch {
    linea = { ts: new Date().toISOString(), nivel, msg: mensaje, contexto: '[no serializable]' };
  }

  // En produccion, JSON: una linea, parseable, con los campos siempre en su
  // sitio. En desarrollo, texto: lo que se lee de un vistazo mientras se
  // programan, que es cuando mas se mira.
  if (env.isProduction) {
    escribir(`${serializar(linea)}\n`);
    return;
  }

  const resto = { ...linea };
  delete resto.ts;
  delete resto.nivel;
  delete resto.msg;

  const hora = linea.ts.slice(11, 23);
  const extras = Object.keys(resto).length > 0 ? ` ${serializar(resto)}` : '';
  escribir(`${hora} ${nivel.toUpperCase().padEnd(5)} ${mensaje}${extras}\n`);
}

/** `JSON.stringify` con red de seguridad: nunca devuelve algo ilegible. */
function serializar(valor) {
  try {
    return JSON.stringify(valor) ?? 'null';
  } catch {
    return '"[no serializable]"';
  }
}

/** `process.stdout.write` con red de seguridad: un stream cerrado no es un crash. */
function escribir(linea) {
  try {
    process.stdout.write(linea);
  } catch {
    /* Si stdout esta cerrado (pipe roto, proceso huerfano), no hay nada que hacer. */
  }
}

export const logger = {
  error: (mensaje, contexto) => emitir('error', mensaje, contexto),
  warn: (mensaje, contexto) => emitir('warn', mensaje, contexto),
  info: (mensaje, contexto) => emitir('info', mensaje, contexto),
  debug: (mensaje, contexto) => emitir('debug', mensaje, contexto),
  trace: (mensaje, contexto) => emitir('trace', mensaje, contexto),

  /** Logger que se ata a una peticion y ya no hay que pasarle el id a mano. */
  child(contexto) {
    return {
      error: (m, c) => emitir('error', m, { ...contexto, ...c }),
      warn: (m, c) => emitir('warn', m, { ...contexto, ...c }),
      info: (m, c) => emitir('info', m, { ...contexto, ...c }),
      debug: (m, c) => emitir('debug', m, { ...contexto, ...c }),
      trace: (m, c) => emitir('trace', m, { ...contexto, ...c }),
    };
  },
};

/**
 * Hash de un token para guardarlo.
 *
 * Los refresh tokens y los de recuperacion se guardan hasheados con SHA-256.
 * A diferencia de las contrasenas no hace falta scrypt: no se atacan por
 * fuerza bruta (son de 32 bytes aleatorios), solo se comparan, y aqui interesa
 * que la comprobacion sea rapida en cada peticion de refresco.
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparacion en tiempo constante de dos hashes. */
export function compararHash(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}

export function nuevoId() {
  return randomUUID();
}

export default logger;
