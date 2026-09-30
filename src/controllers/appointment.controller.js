import { AppError } from "../utils/http.js";
import { citaPublica } from "../utils/serialize.js";
import * as appointmentService from "../services/appointment.service.js";
import {
  parseActualizarCita,
  parseCitaDeAdmin,
  parseFiltros,
  parseSolicitudCita
} from "../validators/appointment.validator.js";

const ESTADOS = ["PENDING", "COORDINATED", "COMPLETED", "CANCELLED", "REJECTED"];

/** Contexto de acceso: ADMIN ve todas las citas, CLIENT sólo las suyas. */
function contexto(request) {
  return {
    esAdmin: request.user.role === "ADMIN",
    clienteId: request.cliente ? request.cliente.id : null
  };
}

/**
 * GET /api/appointments?estado=&desde=&hasta=&clientId=
 * Un cliente puede escribir clientId en la URL, pero sólo se le hace caso si es
 * ADMIN: si no, el filtro se fuerza a su propio cliente. Así un id en la query
 * no abre los datos de otro (regla 12).
 */
export async function listar(request, response) {
  const contextoActual = contexto(request);
  const filtros = parseFiltros(request.query, { estadosValidos: ESTADOS });
  const clientePedido = Number.parseInt(request.query.clientId, 10);

  const clienteId = contextoActual.esAdmin
    ? Number.isInteger(clientePedido) && clientePedido > 0
      ? clientePedido
      : null
    : contextoActual.clienteId;

  const { total, items } = await appointmentService.listarCitas(filtros, {
    ...contextoActual,
    clienteId
  });
  response.json({ total, items: items.map((cita) => citaPublica(cita)) });
}

/** GET /api/appointments/:id — con historial de estados. */
export async function obtener(request, response) {
  const cita = await appointmentService.obtenerCita(request.id, { conHistorial: true });
  appointmentService.exigirAcceso(cita, contexto(request));
  response.json({ cita: citaPublica(cita, { conHistorial: true }) });
}

/**
 * POST /api/appointments
 *   - un CLIENT solicita un servicio sobre un hueco libre (no puede elegir cliente)
 *   - un ADMIN registra una cita para un cliente, PENDING o ya COORDINATED
 */
export async function crear(request, response) {
  if (request.user.role === "ADMIN") {
    const datos = parseCitaDeAdmin(request.body);
    const cita = await appointmentService.crearCitaDeAdmin({ ...datos, actorId: request.user.id });
    return response.status(201).json({ cita: citaPublica(cita), mensaje: "Cita registrada." });
  }

  if (!request.cliente) {
    return response.status(404).json({ error: "Tu perfil de cliente no existe." });
  }
  const datos = parseSolicitudCita(request.body);
  const cita = await appointmentService.solicitarCita({
    ...datos,
    cliente: request.cliente,
    actorId: request.user.id
  });
  return response.status(201).json({
    cita: citaPublica(cita),
    mensaje: "Solicitud enviada. Te avisaremos cuando la confirmemos."
  });
}

/** PUT /api/appointments/:id — admin: nota o reprogramación. */
export async function actualizar(request, response) {
  const cambios = parseActualizarCita(request.body);

  if (cambios.availabilityId) {
    const cita = await appointmentService.reprogramarCita({
      citaId: request.id,
      availabilityId: cambios.availabilityId,
      actorId: request.user.id,
      note: cambios.note ?? null
    });
    return response.json({ cita: citaPublica(cita), mensaje: "Cita reprogramada." });
  }

  const cita = await appointmentService.editarCita({
    citaId: request.id,
    cambios,
    actorId: request.user.id
  });
  return response.json({ cita: citaPublica(cita), mensaje: "Cita actualizada." });
}

/** POST /api/appointments/:id/coordinar | /rechazar | /completar | /cancelar */
export function transicion(estado) {
  return async function cambiar(request, response) {
    const cita = await appointmentService.cambiarEstadoCita({
      citaId: request.id,
      nuevoEstado: estado,
      actorId: request.user.id,
      note: request.body?.nota || null
    });
    response.json({ cita: citaPublica(cita), mensaje: `Cita ${estado.toLowerCase()}.` });
  };
}

/** POST /api/appointments/:id/cancelar — el cliente cancela su cita pendiente. */
export async function cancelarComoCliente(request, response) {
  if (!request.cliente) {
    throw new AppError(404, "Tu perfil de cliente no existe.");
  }
  const cita = await appointmentService.cancelarCitaDelCliente({
    citaId: request.id,
    clienteId: request.cliente.id,
    actorId: request.user.id
  });
  response.json({ cita: citaPublica(cita), mensaje: "Cita cancelada. El horario queda libre." });
}

/** GET /api/appointments/:id/historial */
export async function historial(request, response) {
  const cita = await appointmentService.obtenerCita(request.id, { conHistorial: true });
  appointmentService.exigirAcceso(cita, contexto(request));
  response.json({ historial: citaPublica(cita, { conHistorial: true }).historial });
}

/** DELETE /api/appointments/:id — admin. */
export async function eliminar(request, response) {
  await appointmentService.eliminarCita(request.id);
  response.json({ ok: true, mensaje: "Cita eliminada y horario liberado." });
}

/** GET /api/appointments/resumen — cifras del panel. */
export async function resumen(request, response) {
  response.json({ resumen: await appointmentService.resumenCitas() });
}
