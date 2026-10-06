import { Router } from "express";
import * as controller from "../controllers/auth.controller.js";
import { asincrono } from "../utils/http.js";
import { authenticate, cargarCliente } from "../middleware/auth.middleware.js";

export const authRoutes = Router();

authRoutes.post("/register", asincrono(controller.registrar));
authRoutes.post("/login", asincrono(controller.entrar));
authRoutes.post("/logout", asincrono(controller.salir));

// A partir de aquí hace falta token. cargarCliente adjunta el perfil para que
// /me devuelva las dos mitades de la identidad.
authRoutes.get("/me", authenticate, cargarCliente, asincrono(controller.yo));
authRoutes.post("/password", authenticate, asincrono(controller.cambiarPassword));
