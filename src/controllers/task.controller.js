import { prohibido } from "../utils/http.js";
import { tareaPublica } from "../utils/serialize.js";
import * as taskService from "../services/task.service.js";
import { ESTADOS_TAREA, parseTarea } from "../validators/task.validator.js";
import { parseFiltros } from "../validators/appointment.validator.js";

/**
 * GET /api/tasks
 * Listar todas las tareas es una función de administración (regla 10). El
 * cliente llega aquí sólo a través de sus citas, que ya traen su tarea.
 */
export async function listar(request, response) {
  const filtros = parseFiltros(request.query, { estadosValidos: ESTADOS_TAREA });
  const { total, items } = await taskService.listarTareas(
    {
      ...filtros,
      categoryId: request.query.categoryId ? Number(request.query.categoryId) : null,
      clientId: request.query.clientId ? Number(request.query.clientId) : null
    },
    request.user.businessId
  );
  response.json({ total, items: items.map(tareaPublica) });
}

/** GET /api/tasks/:id — ADMIN, o el cliente cuya tarea es. */
export async function obtener(request, response) {
  const tarea = await taskService.obtenerTarea(request.id, request.user.businessId);
  if (request.user.role !== "ADMIN" && tarea.client?.userId !== request.user.id) {
    throw prohibido("Esa tarea no es tuya.");
  }
  response.json({ tarea: tareaPublica(tarea) });
}

export async function crear(request, response) {
  const datos = parseTarea(request.body);
  const tarea = await taskService.crearTarea(datos, request.user.businessId);
  response.status(201).json({ tarea: tareaPublica(tarea), mensaje: "Tarea creada." });
}

export async function actualizar(request, response) {
  const cambios = parseTarea(request.body);
  const tarea = await taskService.actualizarTarea(request.id, cambios, request.user.businessId);
  response.json({ tarea: tareaPublica(tarea), mensaje: "Tarea actualizada." });
}

export async function eliminar(request, response) {
  await taskService.eliminarTarea(request.id, request.user.businessId);
  response.json({ ok: true, mensaje: "Tarea eliminada." });
}
