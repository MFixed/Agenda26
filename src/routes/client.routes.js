import { Router } from "express";
import * as controller from "../controllers/client.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, cargarCliente, requireAdmin } from "../middleware/auth.middleware.js";
import { validarId } from "../middleware/validar.middleware.js";

export const clientRoutes = Router();

clientRoutes.use(authenticate, cargarCliente);

// Rutas del propio cliente. Van antes que "/:id" para que /me no se tome por un id.
clientRoutes.get("/me", asincrono(controller.miPerfil));
clientRoutes.put("/me", asincrono(controller.actualizarMiPerfil));

// Un id no es un número: se rechaza antes de tocar la base de datos.
clientRoutes.param("id", validarId);

// El resto es administración (regla 10).
clientRoutes.get("/", requireAdmin, asincrono(controller.listar));
clientRoutes.get("/:id", asincrono(controller.obtener));
clientRoutes.post("/", requireAdmin, asincrono(controller.crear));
clientRoutes.put("/:id", requireAdmin, asincrono(controller.actualizar));
clientRoutes.delete("/:id", requireAdmin, asincrono(controller.eliminar));
