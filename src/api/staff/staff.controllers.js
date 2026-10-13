import * as staffService from './service/staff.service.js';
import * as scheduleService from './service/schedule.service.js';
import * as waitlistService from './service/waitlist.service.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  createRules,
  generateRules,
  scheduleRules,
  scheduleUpdateRules,
  updateRules,
  waitlistRules,
} from './staff.validation.js';

/* --- Profesionales --- */

export async function list(req, res) {
  res.json(
    await staffService.list(req.businessId, {
      q: req.query.q,
      activo: req.query.activo === undefined ? undefined : req.query.activo === 'true',
      limit: req.query.limit,
      offset: req.query.offset,
    })
  );
}

export async function detail(req, res) {
  res.json({ profesional: await staffService.detail(req.businessId, Number(req.params.id)) });
}

export async function create(req, res) {
  res
    .status(201)
    .json({ profesional: await staffService.create(req.businessId, createRules(req.body), req) });
}

export async function update(req, res) {
  res.json({
    profesional: await staffService.update(req.businessId, Number(req.params.id), updateRules(req.body), req),
  });
}

export async function remove(req, res) {
  await staffService.remove(req.businessId, Number(req.params.id), req);
  res.status(204).end();
}

/* --- Plantillas de agenda --- */

export async function listSchedules(req, res) {
  res.json({ items: await scheduleService.list(req.businessId) });
}

export async function createSchedule(req, res) {
  res
    .status(201)
    .json({ plantilla: await scheduleService.create(req.businessId, scheduleRules(req.body), req) });
}

export async function updateSchedule(req, res) {
  res.json({
    plantilla: await scheduleService.update(
      req.businessId,
      Number(req.params.id),
      scheduleUpdateRules(req.body),
      req
    ),
  });
}

export async function removeSchedule(req, res) {
  await scheduleService.remove(req.businessId, Number(req.params.id), req);
  res.status(204).end();
}

export async function generateSchedule(req, res) {
  res.json(await scheduleService.generate(req.businessId, generateRules(req.body), req));
}

/* --- Lista de espera --- */

export async function listWaitlist(req, res) {
  res.json(
    await waitlistService.list(req.businessId, {
      status: req.query.status,
      clientId: req.query.clientId,
      limit: req.query.limit,
      offset: req.query.offset,
    })
  );
}

export async function createWaitlist(req, res) {
  const datos = waitlistRules(req.body);
  /// Un CLIENT solo puede apuntarse a si mismo: no hay a quien preguntarle.
  const clientId = req.user.role === 'CLIENT' ? req.user.clientId : datos.clientId;

  if (!clientId) throw ApiError.badRequest('No tienes ficha de cliente');

  res
    .status(201)
    .json({ espera: await waitlistService.create(req.businessId, { ...datos, clientId }, req, {}) });
}

export async function removeWaitlist(req, res) {
  await waitlistService.remove(req.businessId, Number(req.params.id), req);
  res.status(204).end();
}

export default {
  list,
  detail,
  create,
  update,
  remove,
  listSchedules,
  createSchedule,
  updateSchedule,
  removeSchedule,
  generateSchedule,
  listWaitlist,
  createWaitlist,
  removeWaitlist,
};
