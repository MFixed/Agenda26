import * as availabilityService from './service/availability.service.js';
import { createRules, listFilters, updateRules } from './availability.validation.js';

/**
 * Consultar es abierto a todos (el cliente necesita ver los huecos libres);
 * publicar y editar horarios es solo de la administracion.
 */
export async function list(req, res) {
  const timezone = req.business?.timezone ?? 'UTC';

  const filters =
    req.user.role === 'CLIENT'
      ? availabilityService.filtersForClient(req.query, timezone)
      : listFilters(req.query, req.user.role);

  res.json(await availabilityService.list(req.businessId, filters, req.user.id));
}

export async function getById(req, res) {
  res.json({ disponibilidad: await availabilityService.detail(req.businessId, Number(req.params.id)) });
}

export async function create(req, res) {
  res
    .status(201)
    .json({ disponibilidad: await availabilityService.create(req.businessId, createRules(req.body)) });
}

export async function update(req, res) {
  res.json({
    disponibilidad: await availabilityService.update(
      req.businessId,
      Number(req.params.id),
      updateRules(req.body)
    ),
  });
}

export async function remove(req, res) {
  await availabilityService.remove(req.businessId, Number(req.params.id), req, {
    hard: req.query.hard === 'true',
  });
  res.status(204).end();
}

/* --- Retenciones (nuevo en v2) --- */

export async function hold(req, res) {
  /// Los minutos salen de la configuracion del negocio. El cliente no elige: si
  /// pudiera, pediria diez horas y dejaria la agenda bloqueada una tarde entera.
  const minutos = req.business?.settings?.holdMinutes ?? 10;

  res.json(await availabilityService.hold(req.businessId, Number(req.params.id), req.user.id, minutos));
}

export async function releaseHold(req, res) {
  res.json(await availabilityService.releaseHold(req.businessId, Number(req.params.id), req.user.id));
}

export default { list, getById, create, update, remove, hold, releaseHold };
