import { Router } from "express";
import * as controller from "../controllers/category.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, requireAdmin } from "../middleware/auth.middleware.js";

export const categoryRoutes = Router();

categoryRoutes.use(authenticate);

// Lectura: la necesitan los dos. El cliente elige la categoría de su servicio.
categoryRoutes.get("/", asincrono(controller.listar));
categoryRoutes.get("/:id", asincrono(controller.obtener));

// Escritura: sólo ADMIN (regla 10).
categoryRoutes.post("/", requireAdmin, asincrono(controller.crear));
categoryRoutes.put("/:id", requireAdmin, asincrono(controller.actualizar));
categoryRoutes.delete("/:id", requireAdmin, asincrono(controller.eliminar));
