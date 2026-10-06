import { prohibido } from "../utils/http.js";
import { clientePublico } from "../utils/serialize.js";
import * as clientService from "../services/client.service.js";
import { parsePerfilPropio } from "../validators/auth.validator.js";
import { parseActualizarCliente, parseNuevoCliente } from "../validators/client.validator.js";
import { parseFiltros } from "../validators/appointment.validator.js";

/** GET /api/clients?q= — sólo ADMIN (regla 10). */
export async function listar(request, response) {
  const filtros = parseFiltros(request.query);
  const { total, items } = await clientService.listarClientes(filtros, request.user.businessId);
  response.json({
    total,
    items: items.map((cliente) => ({
      ...clientePublico(cliente),
      email: cliente.user.email,
      activo: cliente.user.activo,
      ultimoAcceso: cliente.user.ultimoAcceso?.toISOString() ?? null,
      citas: cliente.citas,
      tareas: cliente.tareas
    }))
  });
}

/** GET /api/clients/:id — ADMIN, o el propio cliente sobre su ficha. */
export async function obtener(request, response) {
  const cliente = await clientService.obtenerCliente(request.id, request.user.businessId);
  if (request.user.role !== "ADMIN" && cliente.userId !== request.user.id) {
    throw prohibido("Este cliente no eres tú.");
  }
  response.json({
    cliente: clientePublico(cliente),
    email: cliente.user.email,
    activo: cliente.user.activo,
    ultimoAcceso: cliente.user.ultimoAcceso?.toISOString() ?? null,
    citas: cliente._count.appointments,
    tareas: cliente._count.tasks
  });
}

/** POST /api/clients — alta manual (ADMIN). */
export async function crear(request, response) {
  const datos = parseNuevoCliente(request.body);
  const { cliente, passwordTemporal } = await clientService.crearCliente(datos, request.user.businessId);
  response.status(201).json({
    cliente: clientePublico(cliente),
    passwordTemporal,
    mensaje: passwordTemporal
      ? "Cliente creado. Anota la contraseña temporal: no se vuelve a mostrar."
      : "Cliente creado."
  });
}

/** PUT /api/clients/:id — ADMIN. */
export async function actualizar(request, response) {
  const cambios = parseActualizarCliente(request.body);
  const cliente = await clientService.actualizarCliente(request.id, cambios, request.user.businessId);
  response.json({ cliente: clientePublico(cliente), mensaje: "Cliente actualizado." });
}

/** DELETE /api/clients/:id — ADMIN. El admin no puede borrarse a sí mismo. */
export async function eliminar(request, response) {
  const cliente = await clientService.eliminarCliente(request.id, request.user);
  response.json({ ok: true, mensaje: `Cliente ${cliente.nombre} eliminado.` });
}

/** GET /api/clients/me — el propio cliente. */
export function miPerfil(request, response) {
  const cliente = request.cliente;
  if (!cliente) {
    return response.status(404).json({ error: "Tu perfil de cliente no existe." });
  }
  return response.json({
    cliente: clientePublico(cliente, { conUsuario: true }),
    citas: cliente._count.appointments,
    tareas: cliente._count.tasks
  });
}

/** PUT /api/clients/me — el cliente corrige su propia ficha (rol y estado intocables). */
export async function actualizarMiPerfil(request, response) {
  const cambios = parsePerfilPropio(request.body);
  const cliente = await clientService.actualizarPerfilPropio(request.user.id, cambios);

  // Si el cliente cambia la contraseña desde aquí, se valida la actual.
  if (cambios.passwordNueva) {
    await clientService.cambiarPasswordPropia(request.user, cambios);
  }
  response.json({ cliente: clientePublico(cliente), mensaje: "Perfil actualizado." });
}
