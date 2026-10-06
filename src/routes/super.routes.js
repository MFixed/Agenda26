import { Router } from "express";
import * as controller from "../controllers/business.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, requireSuperAdmin } from "../middleware/auth.middleware.js";
import { validarId } from "../middleware/validar.middleware.js";

export const superRoutes = Router();

// Equipo de la plataforma: siempre rol SUPERADMIN.
superRoutes.use(authenticate, requireSuperAdmin);
superRoutes.get("/negocios", asincrono(controller.listar));
superRoutes.post("/negocios", asincrono(controller.crear));
superRoutes.param("id", validarId);
superRoutes.patch("/negocios/:id", asincrono(controller.cambiarEstado));

export const publicRoutes = Router();
// Info pública de un negocio (nombre, slug) para pintar su página de acceso.
publicRoutes.get("/negocios/:slug", asincrono(controller.info));
