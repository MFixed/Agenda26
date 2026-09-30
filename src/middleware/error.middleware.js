import { AppError, noEncontrado } from "../utils/http.js";

/** 404 para rutas de API; las de páginas se resuelven en routes/pages.routes.js. */
export function noEncontradoJson(request, response) {
  response.status(404).json({ error: "Ruta no encontrada." });
}

/**
 * Manejador centralizado de errores (§23). Un solo sitio donde se decide qué se
 * le cuenta al cliente y qué se queda en el registro del servidor.
 */
export function manejadorDeErrores(error, request, response, next) {
  if (response.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return response
      .status(error.estado)
      .json({ error: error.message, details: error.detalles ?? null });
  }

  // Violación de unicidad de Prisma: no se filtra el nombre de la columna.
  if (error?.code === "P2002") {
    return response.status(409).json({ error: "Ya existe un registro con esos datos." });
  }
  // Referencia a un id que no existe.
  if (error?.code === "P2025" || error?.code === "P2003") {
    return noEncontrado();
  }
  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({ error: "El cuerpo debe ser JSON válido." });
  }

  console.error("Error no controlado:", error);
  return response.status(500).json({ error: "Error interno del servidor." });
}
