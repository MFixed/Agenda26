import { Router } from "express";
import * as controller from "../controllers/availability.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, requireAdmin, requireEmpresa } from "../middleware/auth.middleware.js";
import { validarId } from "../middleware/validar.middleware.js";

export const availabilityRoutes = Router();

availabilityRoutes.use(authenticate, requireEmpresa);

// Cualquiera de los dos roles lee, pero el service ya devuelve huecos distintos
// según quién pregunte: el cliente sólo ve lo libre y futuro.
availabilityRoutes.get("/", asincrono(controller.listar));
availabilityRoutes.get("/huecos", asincrono(controller.huecos));

availabilityRoutes.param("id", validarId);
availabilityRoutes.get("/:id", asincrono(controller.obtener));

// Publicar, mover, bloquear y borrar disponibilidad es sólo del ADMIN (regla 10).
availabilityRoutes.post("/", requireAdmin, asincrono(controller.crear));
availabilityRoutes.put("/:id", requireAdmin, asincrono(controller.actualizar));
availabilityRoutes.delete("/:id", requireAdmin, asincrono(controller.eliminar));
