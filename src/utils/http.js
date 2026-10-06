/**
 * Utilidades de HTTP compartidas por controladores y middleware.
 *
 * Aquí viven el error de aplicación y el envoltorio de controladores async: en
 * Express 5 los rechazos de promesa ya llegan al manejador de errores, pero el
 * envoltorio mantiene los controladores explícitos y compatibles con Express 4.
 */

export class AppError extends Error {
  constructor(estado, mensaje, detalles = null) {
    super(mensaje);
    this.name = "AppError";
    this.estado = estado;
    this.detalles = detalles;
  }
}

export const errorValidacion = (mensaje, detalles) => new AppError(422, mensaje, detalles);
export const noEncontrado = (mensaje = "El recurso no existe.") => new AppError(404, mensaje);
export const prohibido = (mensaje = "No tienes permisos para esta operación.") => new AppError(403, mensaje);
export const conflicto = (mensaje) => new AppError(409, mensaje);
export const noAutorizado = (mensaje = "Necesitas iniciar sesión para continuar.") => new AppError(401, mensaje);

/** Envuelve un controlador async para que sus rechazos lleguen al error.middleware. */
export function asincrono(funcion) {
  return function envolvido(request, response, next) {
    Promise.resolve(funcion(request, response, next)).catch(next);
  };
}
