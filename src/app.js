import express from "express";
import path from "node:path";
import { config } from "./config/index.js";
import { healthRoutes } from "./routes/health.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { clientRoutes } from "./routes/client.routes.js";
import { categoryRoutes } from "./routes/category.routes.js";
import { taskRoutes } from "./routes/task.routes.js";
import { availabilityRoutes } from "./routes/availability.routes.js";
import { appointmentRoutes } from "./routes/appointment.routes.js";
import { notificationRoutes } from "./routes/notification.routes.js";
import { superRoutes, publicRoutes } from "./routes/super.routes.js";
import { manejadorDeErrores, noEncontradoJson } from "./middleware/error.middleware.js";

/**
 * App de Express. Se separa de server.js para que las pruebas puedan importar
 * la app sin abrir un puerto.
 */
export function crearApp() {
  const app = express();

  app.disable("x-powered-by");

  // Cabeceras mínimas de seguridad sin dependencias (tipo helmet).
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  // El token va en la cabecera Authorization, no en cookie, así que sólo hace
  // falta leer JSON. El límite corta cuerpos gigantes antes de validarlos.
  app.use(express.json({ limit: "64kb" }));

  // API
  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  // Los seis routers siguientes son la aplicación de una empresa: todo lo que hay
  // dentro cuelga de un negocio. Cada uno se protege con requireEmpresa en su
  // propio use(), detrás de authenticate (ver auth.middleware.js).
  app.use("/api/clients", clientRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/availability", availabilityRoutes);
  app.use("/api/appointments", appointmentRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/super", superRoutes);
  app.use("/api", publicRoutes);

  // Páginas: HTML plano desde public/, sin motor de plantillas.
  const publica = path.join(config.raiz, "public");
  app.use(express.static(publica, { extensions: ["html"], maxAge: config.esProduccion ? "1h" : 0 }));

  // Rutas: "/" y las de cada sección. Cada una comprueba el rol en el navegador
  // y redirige si no corresponde; la API es la que realmente protege los datos.
  const paginas = {
    "/inicio": "index.html",
    "/login": "login.html",
    "/registro": "register.html",
    "/admin": "admin/dashboard.html",
    "/admin/calendario": "admin/calendar.html",
    "/admin/tareas": "admin/tasks.html",
    "/admin/citas": "admin/appointments.html",
    "/admin/clientes": "admin/clients.html",
    "/cliente": "client/dashboard.html",
    "/cliente/citas": "client/appointments.html",
    "/cliente/perfil": "client/profile.html",
    "/super": "super.html"
  };
  for (const [ruta, archivo] of Object.entries(paginas)) {
    app.get(ruta, (request, response) => response.sendFile(archivo, { root: publica }));
  }

  // Puerta de cada negocio: login y registro con su slug en la URL. Dos negocios
  // comparten la misma app, pero cada cliente y cada admin entra por la suya.
  app.get("/b/:slug", (request, response) => response.redirect(`/b/${request.params.slug}/login`));
  app.get("/b/:slug/login", (request, response) => response.sendFile("login.html", { root: publica }));
  app.get("/b/:slug/registro", (request, response) => response.sendFile("register.html", { root: publica }));

  // Cualquier otra ruta de API responde JSON; el resto, 404.
  app.use("/api", noEncontradoJson);
  app.use((request, response) => {
    response.status(404).sendFile("404.html", { root: publica });
  });

  app.use(manejadorDeErrores);
  return app;
}
