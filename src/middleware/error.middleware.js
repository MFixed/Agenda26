import { AppError, noEncontrado } from "../utils/http.js";

/** Mismos patrones que en config/database.js: se traducen a un 503 con explicación. */
const ES_SIN_VARIABLE = /environment variable not found|resolved to an empty string/i;
const ES_ERROR_DE_CONEXION =
  /unable to open the database|ECONNREFUSED|password authentication|server has closed the connection|can't reach database|host not found|ENOTFOUND/i;

/** 404 para rutas de API; las de páginas se resuelven en app.js. */
export function noEncontradoJson(request, response) {
  response.status(404).json({ error: "Ruta no encontrada." });
}

/**
 * Errores de Prisma que el cliente puede entender y arreglar.
 *
 * El caso de uso real: un despliegue nuevo en Render sin DATABASE_URL defined
 * respondía "Error interno del servidor." a todo, sin decir una palabra de por
 * qué. Quien no conoce el proyecto no tiene forma de adivinar que el problema
 * era una variable de entorno.
 *
 * El mensaje al cliente es corto y no filtra rutas ni credenciales; el detalle
 * completo se queda en el registro del servidor, que es donde debe estar.
 */
function explicacionDePrisma(error) {
  const codigo = String(error?.code || "");
  const texto = String(error?.message || "");

  if (codigo === "P2021") {
    return "La base de datos no tiene las tablas. Faltan las migraciones por aplicar.";
  }
  if (ES_SIN_VARIABLE.test(texto)) {
    return "Falta configurar la base de datos: la variable DATABASE_URL no está definida.";
  }
  if (ES_ERROR_DE_CONEXION.test(texto)) {
    return "No se puede conectar con la base de datos. Revisa DATABASE_URL.";
  }
  return null;
}

/**
 * Manejador centralizado de errores (§23). Un solo sitio donde se decide qué
 * se le cuenta al cliente y qué se queda en el registro del servidor.
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

  const explicacion = explicacionDePrisma(error);
  if (explicacion) {
    // En el registro va todo; al cliente, la explicación sin datos de conexión.
    console.error(`${request.method} ${request.originalUrl} -> ${explicacion}`);
    console.error(error);
    return response.status(503).json({
      error: explicacion,
      pista: "Abre /api/health para ver el estado y cómo arreglarlo."
    });
  }

  console.error("Error no controlado:", error);
  return response.status(500).json({ error: "Error interno del servidor." });
}
