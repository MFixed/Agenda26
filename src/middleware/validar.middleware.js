import { errorValidacion } from "../utils/http.js";

/**
 * Los ids de las rutas llegan del frontend, así que no se fían (regla 12).
 * Este middleware se engancha con router.param("id", validarId) en cada router.
 */
export function validarId(request, response, next, valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) {
    return next(errorValidacion("Identificador no válido.", [{ field: "id", message: "El id debe ser un número entero positivo." }]));
  }
  request.id = id;
  return next();
}
