import { Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';

/**
 * Error de la API con codigo HTTP.
 *
 * Los services lanzan estos errores y el handler global los traduce a una
 * respuesta JSON consistente. La regla es simple: lo que se lanza desde un
 * service tiene que ser un ApiError. Cualquier otra cosa es un 500.
 */
export class ApiError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
    this.expected = true;
  }

  static badRequest(message = 'Peticion invalida', details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'No autenticado') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'No autorizado') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Recurso no encontrado') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflicto con el estado actual', details) {
    return new ApiError(409, message, details);
  }

  static tooManyRequests(message = 'Demasiadas peticiones') {
    return new ApiError(429, message);
  }

  static internal(message = 'Error interno del servidor') {
    const err = new ApiError(500, message);
    // No se marca como esperado: el handler lo registra entero.
    err.expected = false;
    return err;
  }
}

/**
 * Traduce los errores conocidos del ORM a respuestas de la API.
 *
 * Esta traduccion vive en un solo sitio y no en cada service, que es lo que
 *acia falta en v1: cada uno repetia el switch y siempre se olvidaba uno.
 */
function fromPrismaError(err) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (err.code) {
    case 'P2002': {
      const texto = `${err.meta?.message ?? ''} ${err.message ?? ''}`;

      /**
       * El indice UNIQUE PARCIAL `Appointment_hueco_vivo_key` violado.
       *
       * Es el indice que impide el doble booking. SQLite NO lo reporta con su
       * nombre (no admite indices parciales en el `schema.prisma`, asi que Prisma no
       * lo conoce) sino como "Unique constraint failed on the fields
       * (availabilityId)". Por eso se busca el nombre de la columna: un P2002 sobre
       * `availabilityId` solo puede ser este indice, porque ninguna otra tabla tiene
       * una restriccion unica sobre esa columna.
       *
       * Sin esta traduccion, el cliente recibiria un "Ya existe un registro con esos
       * datos" que no le dice nada: el problema no son sus datos, es que otra
       * persona ha reservado ese hueco treinta milisegundos antes.
       */
      if (texto.includes('availabilityId')) {
        return ApiError.conflict('Ese horario acaba de ser reservado por otra persona');
      }

      /*
       * Se intenta decir QUE campo choco: "el email ya esta en uso" es accionable,
       * "ya existe un registro con esos datos" obliga a adivinar.
       *
       * `meta.target` llega con TODAS las columnas del indice, no solo con la que
       * choca: para `(businessId, documento)` devolvia `["businessId","documento"]` y
       * el mensaje decia "businessId ya esta en uso", que no ayuda de nada (esa
       * columna no la eligio el usuario). Se cogen los campos de tipo y se descarta
       * lo que forma parte de la clave(primary y las de negocio que no se rellenan
       * desde el formulario).
       */
      const campos = (err.meta?.target ?? []).filter((c) => typeof c === 'string');

      /// Columnas que casi nunca son la causa y cuya mensagem no orienta.
      const RUIDOSAS = new Set([
        'id',
        'businessId',
        'clientId',
        'userId',
        'staffId',
        'taskId',
        'appointmentId',
      ]);

      const culpable = campos.filter((c) => !RUIDOSAS.has(c));

      const detalle = culpable.length > 0 ? `${culpable.join(', ')} ya está en uso` : campos.join(', ');

      return ApiError.conflict('Ya existe un registro con esos datos', [
        { field: culpable[0] ?? campos[0], message: detalle },
      ]);
    }

    case 'P2003':
      return ApiError.badRequest('La referencia indicada no existe o está en uso');

    case 'P2025':
      return ApiError.notFound();

    /**
     * Violacion de clave foranea, pero en SQLite llega con este codigo cuando el
     * borrado en cascada choca con algo. Se traduce al mismo 400 que en PostgreSQL.
     */
    case 'P2011':
      return ApiError.badRequest('La referencia indicada no existe o está en uso');

    /**
     * SQLite cerro la base mientras escribiamos.
     *
     * P1008 con este texto sale de verdad en desarrollo: SQLite acepta un solo
     * escritor, y con el watcher de `--watch` y el worker de jobs escribiendo a la
     * vez la base se bloquea. `busy_timeout` (ver `config/driver.js`) reduce mucho
     * esto, pero si aun asi ocurre, es un 503 y no un 500: la peticion se puede
     * repetir y el servicio puede atender por otro lado.
     */
    case 'P1008': {
      if (/database is locked|timed out fetching a new connection/i.test(String(err.message ?? ''))) {
        return new ApiError(503, 'La base esta ocupada. Intentalo de nuevo en un momento.');
      }

      return null;
    }

    default:
      return null;
  }
}

/**
 * Traduce "no hay base de datos" a 503.
 *
 * No sale de `fromPrismaError` porque no es un `KnownRequestError`: es un fallo de
 * conexion. Pero la distincion importa: un 503 le dice al balanceador que esta
 * instancia no puede atender y que debe mandarle el trafico a otra, mientras que un
 * 500 le dice que la peticion estaba mal. Con la base caida, todas las peticiones
 * estan mal Y el servicio no puede hacer nada: hay que decirlo distinto.
 *
 * Se mira el mensaje y no el codigo porque Prisma no normaliza los errores de
 * conexion en un codigo estable entre versiones.
 */
function fromConnectionError(err) {
  const mensaje = String(err?.message ?? '');

  const esFalloDeConexion =
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    /// PostgreSQL: el servidor esta caido o no llega.
    /Can't reach database server|ECONNREFUSED|ETIMEDOUT|Connection terminated|server closed the connection/i.test(
      mensaje
    ) ||
    /// SQLite: el fichero no existe, esta bloqueado o el path no se puede abrir.
    /SQLITE_CANTOPEN|SQLITE_BUSY|SQLITE_LOCKED|SQLITE_READONLY|unable to open database file/i.test(mensaje);

  if (!esFalloDeConexion) return null;

  /// El mensaje original dice la ruta del fichero o el host y el puerto. Eso no
  /// sale: quien lo recibe necesita saber que reintente, no donde esta la base.
  return new ApiError(503, 'El servicio no puede atender en este momento. Intentalo de nuevo en un momento.');
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    requestId: req.id,
  });
}

/**
 * Handler global. Unico lugar donde se decide que se le devuelve al cliente.
 *
 * Dos reglas que no se negocian:
 *  - Un error desconocido responde 500 con un mensaje generico. El mensaje real
 *    puede traer rutas de archivos o consultas SQL, y eso no sale de aqui.
 *  - Todo 5xx se registra entero, con el requestId, para poder seguirlo desde
 *    el log. Los 4xx son culpa de quien llama y se registran en debug.
 */
export function errorHandler(err, req, res, _next) {
  const requestId = req.id;
  const contexto = {
    requestId,
    metodo: req.method,
    ruta: req.originalUrl,
    userId: req.user?.id ?? null,
  };

  if (res.headersSent) {
    return _next(err);
  }

  const finalError = fromPrismaError(err) ?? fromConnectionError(err) ?? err;
  const esApiError = finalError instanceof ApiError;
  const status = esApiError ? finalError.status : 500;

  if (status >= 500) {
    logger.error('error no controlado', { ...contexto, status, error: finalError });
  } else {
    logger.debug('error controlado', {
      ...contexto,
      status,
      mensaje: finalError.message,
    });
  }

  res.status(status).json({
    error: esApiError ? finalError.message : 'Error interno del servidor',
    ...(esApiError && finalError.details.length > 0 ? { details: finalError.details } : {}),
    requestId,
  });
}

export default { ApiError, notFoundHandler, errorHandler };
