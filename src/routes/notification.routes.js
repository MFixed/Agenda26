import { Router } from "express";
import * as controller from "../controllers/notification.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { validarId } from "../middleware/validar.middleware.js";

export const notificationRoutes = Router();

// Las notificaciones son siempre las del usuario de la sesión: no hay forma de
// pedir las de otro, porque el id sale del token y no de la URL.
notificationRoutes.use(authenticate);

notificationRoutes.get("/", asincrono(controller.listar));
notificationRoutes.put("/read-all", asincrono(controller.marcarTodas));

notificationRoutes.param("id", validarId);
notificationRoutes.put("/:id/read", asincrono(controller.marcarLeida));
