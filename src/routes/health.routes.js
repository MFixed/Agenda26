import { Router } from "express";
import { diagnostico } from "../config/database.js";
import { config } from "../config/index.js";
import { asincrono } from "../utils/http.js";

/**
 * Estado del servicio. Sin autenticación a propósito: es lo primero que mira
 * Render al comprobar que el despliegue está vivo, y lo primero que hay que
 * abrir cuando algo devuelve 500.
 *
 * Dice qué falla y cómo arreglarlo, no sólo que algo falla. Un health check que
 * responde "no" sin explicación obliga a ir al registro del servidor, y el
 * registro del servidor en un despliegue se lee una vez y se pierde en el
 * siguiente despliegue.
 */
export const healthRoutes = Router();

healthRoutes.get(
  "/",
  asincrono(async (request, response) => {
    const estado = await diagnostico();
    const cuerpo = {
      ok: estado.ok,
      version: "1.0.0",
      entorno: config.esProduccion ? "produccion" : "desarrollo",
      baseDeDatos: estado.ok
        ? { ok: true, motor: estado.motor, usuarios: estado.usuarios }
        : { ok: false, problema: estado.problema, detalle: estado.detalle, comoSeArregla: estado.comoSeArregla }
    };

    // Los avisos de arranque (secreto efímero, data/ no escribible) se devuelven
    // aquí y en el registro, pero no hacen que el servicio esté unhealthy: la
    // aplicación funciona.
    if (config.avisos.length > 0) {
      cuerpo.avisos = config.avisos;
    }

    response.status(estado.ok ? 200 : 503).json(cuerpo);
  })
);
