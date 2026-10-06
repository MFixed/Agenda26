import { Router } from "express";
import * as controller from "../controllers/task.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, requireAdmin, requireEmpresa } from "../middleware/auth.middleware.js";
import { validarId } from "../middleware/validar.middleware.js";

export const taskRoutes = Router();

taskRoutes.use(authenticate, requireEmpresa);

// Consultar todas las tareas es de administración (regla 10). El cliente ve la
// tarea de sus citas a través de la cita.
taskRoutes.get("/", requireAdmin, asincrono(controller.listar));
taskRoutes.get("/:id", asincrono(controller.obtener));

taskRoutes.param("id", validarId);

taskRoutes.post("/", requireAdmin, asincrono(controller.crear));
taskRoutes.put("/:id", requireAdmin, asincrono(controller.actualizar));
taskRoutes.delete("/:id", requireAdmin, asincrono(controller.eliminar));
