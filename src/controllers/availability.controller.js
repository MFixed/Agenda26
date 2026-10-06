import { disponibilidadPublica } from "../utils/serialize.js";
import * as availabilityService from "../services/availability.service.js";
import { parseActualizarDisponibilidad, parseDisponibilidad } from "../validators/availability.validator.js";

/**
 * GET /api/availability
 * El admin ve todo lo publicado; un cliente sólo los huecos libres y futuros,
 * que son los únicos que puede pulsar.
 */
export async function listar(request, response) {
  const esAdmin = request.user.role === "ADMIN";
  const { desde, hasta, estado } = request.query;

  if (!esAdmin) {
    const huecos = await availabilityService.listarHuecosReservables({ desde, hasta }, request.user.businessId);
    return response.json({ items: huecos.map((hueco) => disponibilidadPublica(hueco)) });
  }

  const disponibilidades = await availabilityService.listarDisponibilidades(
    {
      desde,
      hasta,
      estado: estado || undefined,
      conCita: true
    },
    request.user.businessId
  );
  return response.json({
    items: disponibilidades.map((disponibilidad) => disponibilidadPublica(disponibilidad))
  });
}

/** GET /api/availability/huecos — alias explícito para el frontal del cliente. */
export async function huecos(request, response) {
  const items = await availabilityService.listarHuecosReservables(request.query, request.user.businessId);
  response.json({ items: items.map((hueco) => disponibilidadPublica(hueco)) });
}

export async function obtener(request, response) {
  const disponibilidad = await availabilityService.obtenerDisponibilidad(request.id, undefined, request.user.businessId);
  response.json({ disponibilidad: disponibilidadPublica(disponibilidad) });
}

export async function crear(request, response) {
  const datos = parseDisponibilidad(request.body);
  const disponibilidad = await availabilityService.crearDisponibilidad(datos, request.user.businessId);
  response.status(201).json({ disponibilidad: disponibilidadPublica(disponibilidad), mensaje: "Horario publicado." });
}

export async function actualizar(request, response) {
  const cambios = parseActualizarDisponibilidad(request.body);
  const disponibilidad = await availabilityService.actualizarDisponibilidad(request.id, cambios, request.user.businessId);
  response.json({ disponibilidad: disponibilidadPublica(disponibilidad), mensaje: "Horario actualizado." });
}

export async function eliminar(request, response) {
  await availabilityService.eliminarDisponibilidad(request.id, request.user.businessId);
  response.json({ ok: true, mensaje: "Horario eliminado." });
}
