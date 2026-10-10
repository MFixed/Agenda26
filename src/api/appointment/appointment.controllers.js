import * as appointmentService from './service/appointment.service.js';
import { createRules, listFilters, updateRules } from './appointment.regex.js';
import { resolveBusinessId } from '../../middlewares/auth.js';

export async function list(req, res) {
  res.json(await appointmentService.list(req.user, resolveBusinessId(req), listFilters(req.query)));
}

export async function resumen(req, res) {
  res.json(await appointmentService.resumen(req.user, resolveBusinessId(req)));
}

export async function getById(req, res) {
  res.json({ cita: await appointmentService.detail(req.user, resolveBusinessId(req), Number(req.params.id)) });
}

export async function create(req, res) {
  const cita = await appointmentService.create(req.user, resolveBusinessId(req), createRules(req.body));
  res.status(201).json({ cita });
}

export async function update(req, res) {
  const cita = await appointmentService.update(
    req.user,
    resolveBusinessId(req),
    Number(req.params.id),
    updateRules(req.body)
  );
  res.json({ cita });
}

export async function remove(req, res) {
  await appointmentService.remove(req.user, resolveBusinessId(req), Number(req.params.id));
  res.status(204).end();
}

/**
 * Acciones del modal de detalle. Cada una es una ruta distinta en vez de un
 * PATCH con { status }: asi el estado de destino no lo escribe el que llama, y
 * una accion equivocada no se puede alcanzar por error con un estado mal
 * escrito.
 */
function accion(nombre) {
  return async (req, res) => {
    const cita = await appointmentService.actuar(req.user, resolveBusinessId(req), Number(req.params.id), nombre, {
      note: req.body?.note,
    });

    res.json({ cita });
  };
}

export const coordinar = accion('coordinar');
export const completar = accion('completar');
export const rechazar = accion('rechazar');
export const cancelarAdmin = accion('cancelar-admin');
export const cancelar = accion('cancelar');