import * as businessService from "../services/business.service.js";
import { parseEstadoNegocio, parseNuevoNegocio } from "../validators/business.validator.js";

/** GET /api/super/negocios — listado para el panel de plataforma. */
export async function listar(request, response) {
  response.json({ items: await businessService.listarNegocios() });
}

/** POST /api/super/negocios — crea negocio + primer administrador. */
export async function crear(request, response) {
  const datos = parseNuevoNegocio(request.body);
  const negocio = await businessService.crearNegocio(datos);
  response.status(201).json({
    negocio: {
      id: negocio.id,
      nombre: negocio.nombre,
      slug: negocio.slug,
      activo: negocio.activo
    },
    mensaje: `Negocio creado. Su administrador entra en /b/${negocio.slug}/login`
  });
}

/** PATCH /api/super/negocios/:id — activa o desactiva. */
export async function cambiarEstado(request, response) {
  const { activo } = parseEstadoNegocio(request.body);
  const negocio = await businessService.cambiarEstadoNegocio(request.id, activo);
  response.json({ negocio, mensaje: activo ? "Negocio activado." : "Negocio desactivado." });
}

/** GET /api/negocios/:slug — info pública de un negocio (para pintar su login). */
export async function info(request, response) {
  const negocio = await businessService.infoPublica(request.params.slug);
  response.json({ negocio });
}
