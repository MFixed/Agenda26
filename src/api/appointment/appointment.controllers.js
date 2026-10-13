import * as appointmentService from './service/appointment.service.js';
import { actionRules, createRules, listFilters, updateRules } from './appointment.validation.js';

const ctx = (req) => ({ timezone: req.business?.timezone ?? 'UTC' });

export async function list(req, res) {
  res.json(await appointmentService.list(req.user, req.businessId, listFilters(req.query)));
}

export async function resumen(req, res) {
  res.json(await appointmentService.resumen(req.user, req.businessId, req.business?.timezone));
}

export async function getById(req, res) {
  res.json({ cita: await appointmentService.detail(req.user, req.businessId, Number(req.params.id)) });
}

export async function create(req, res) {
  const cita = await appointmentService.create(
    req.user,
    req.businessId,
    createRules(req.body),
    req,
    ctx(req)
  );
  res.status(201).json({ cita });
}

export async function update(req, res) {
  const cita = await appointmentService.update(
    req.user,
    req.businessId,
    Number(req.params.id),
    updateRules(req.body),
    req,
    ctx(req)
  );
  res.json({ cita });
}

export async function remove(req, res) {
  await appointmentService.remove(req.user, req.businessId, Number(req.params.id), req, {
    hard: req.query.hard === 'true',
  });
  res.status(204).end();
}

/**
 * Acciones del modal de detalle. Cada una es una ruta distinta en vez de un
 * PATCH con { status }: asi el estado de destino no lo escribe el que llama, y una
 * accion equivocada no se puede alcanzar por error con un estado mal escrito.
 */
function accion(nombre) {
  return async (req, res) => {
    const cita = await appointmentService.actuar(
      req.user,
      req.businessId,
      Number(req.params.id),
      nombre,
      actionRules(req.body),
      req,
      ctx(req)
    );

    res.json({ cita });
  };
}

export const coordinar = accion('coordinar');
export const completar = accion('completar');
export const rechazar = accion('rechazar');
export const cancelarAdmin = accion('cancelar-admin');
export const cancelar = accion('cancelar');
export const noShow = accion('no-show');

/** Registro de llegada (nuevo en v2). No cambia el estado, solo marca la hora. */
export async function checkin(req, res) {
  res.json({ cita: await appointmentService.checkin(req.user, req.businessId, Number(req.params.id), req) });
}

export default {
  list,
  resumen,
  getById,
  create,
  update,
  remove,
  coordinar,
  completar,
  rechazar,
  cancelarAdmin,
  cancelar,
  noShow,
  checkin,
};
