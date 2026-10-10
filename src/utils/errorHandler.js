import { Prisma } from '@prisma/client';

/**
 * Traduce los errores conocidos del ORM a respuestas de la API. Asi los
 * services no repiten el chequeo de codigos de error de Prisma.
 */
function fromPrismaError(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return ApiError.conflict('Ya existe un registro con esos datos unicos');
      case 'P2003':
        return ApiError.badRequest('La referencia indicada no existe o esta en uso');
      case 'P2025':
        return ApiError.notFound();
      default:
        return null;
    }
  }

  return null;
}

/**
 * Error de la API con codigo HTTP. Los services lanzan estos errores y el
 * handler global los traduce a una respuesta JSON consistente.
 *
 * `details` es siempre una lista de { field, message }: es lo que el frontend
 * junta en un solo renglón debajo del formulario, asi que tiene que ser
 * iterable y no un objeto suelto.
 */
export class ApiError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
  }

  static badRequest(message, details) {
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

  static conflict(message) {
    return new ApiError(409, message);
  }
}

// Express 5 propaga automaticamente los rechazos de handlers async, asi que
// no hace falta un wrapper para capturar errores.

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

/**
 * Handler global. Unico lugar donde se decide que se le devuelve al cliente.
 * Los errores desconocidos nunca exponen su mensaje original.
 */
export function errorHandler(err, req, res, _next) {
  const finalError = fromPrismaError(err) ?? err;
  const esApiError = finalError instanceof ApiError;

  if (!esApiError) {
    console.error('[error]', req.method, req.originalUrl, err);
  }

  res.status(esApiError ? finalError.status : 500).json({
    error: esApiError ? finalError.message : 'Error interno del servidor',
    ...(esApiError && finalError.details.length > 0 ? { details: finalError.details } : {}),
  });
}