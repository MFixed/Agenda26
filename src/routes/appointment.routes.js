import { Router } from "express";
import * as controller from "../controllers/appointment.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, cargarCliente, requireAdmin, requireEmpresa } from "../middleware/auth.middleware.js";
import { validarId } from "../middleware/validar.middleware.js";

export const appointmentRoutes = Router();

appointmentRoutes.use(authenticate, requireEmpresa, cargarCliente);

// Listar: un cliente recibe sólo sus citas, un admin todas (regla 8 y 10).
appointmentRoutes.get("/", asincrono(controller.listar));
appointmentRoutes.get("/resumen", requireAdmin, asincrono(controller.resumen));

// Pedir cita: el cliente solicita sobre un hueco libre; el admin registra una
// cita para un cliente. El service comprueba el estado del horario.
appointmentRoutes.post("/", asincrono(controller.crear));

appointmentRoutes.param("id", validarId);

appointmentRoutes.get("/:id", asincrono(controller.obtener));
appointmentRoutes.get("/:id/historial", asincrono(controller.historial));

/* El cliente cancela la suya mientras esté pendiente: POST .../cancelar sin
   necesidad de ser admin, porque el service comprueba que sea suya. */
appointmentRoutes.post("/:id/cancelar", asincrono(controller.cancelarComoCliente));

/* Resolver una cita es de administración (regla 10). Son rutas explícitas en
   lugar de un PATCH con un "status" libre: así cada transición tiene sus
   requisitos y no se puede saltar de estado desde el frontend. */
appointmentRoutes.post("/:id/coordinar", requireAdmin, asincrono(controller.transicion("COORDINATED")));
appointmentRoutes.post("/:id/rechazar", requireAdmin, asincrono(controller.transicion("REJECTED")));
appointmentRoutes.post("/:id/completar", requireAdmin, asincrono(controller.transicion("COMPLETED")));
appointmentRoutes.post("/:id/cancelar-admin", requireAdmin, asincrono(controller.transicion("CANCELLED")));

appointmentRoutes.put("/:id", requireAdmin, asincrono(controller.actualizar));
appointmentRoutes.delete("/:id", requireAdmin, asincrono(controller.eliminar));
