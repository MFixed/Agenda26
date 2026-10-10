import * as availabilityService from './service/availability.service.js';
import { createRules, updateRules, STATUSES } from './availability.regex.js';
import { resolveBusinessId } from '../../middlewares/auth.js';
import { ApiError } from '../../utils/errorHandler.js';

function assertEstado(valor) {
  if (valor && !STATUSES.includes(valor)) {
    throw ApiError.badRequest(`estado debe ser uno de: ${STATUSES.join(', ')}`);
  }
}

export async function list(req, res) {
  const businessId = resolveBusinessId(req);
  const filters =
    req.user.role === 'CLIENT'
      ? availabilityService.filtersForClient(req.query)
      : { estado: req.query.estado, desde: req.query.desde, hasta: req.query.hasta, limit: req.query.limit };

  assertEstado(filters.estado);

  res.json(await availabilityService.list(businessId, filters));
}

export async function getById(req, res) {
  res.json({ disponibilidad: await availabilityService.detail(resolveBusinessId(req), Number(req.params.id)) });
}

export async function create(req, res) {
  const disponibilidad = await availabilityService.create(resolveBusinessId(req), createRules(req.body));
  res.status(201).json({ disponibilidad });
}

export async function update(req, res) {
  const disponibilidad = await availabilityService.update(
    resolveBusinessId(req),
    Number(req.params.id),
    updateRules(req.body)
  );
  res.json({ disponibilidad });
}

export async function remove(req, res) {
  await availabilityService.remove(resolveBusinessId(req), Number(req.params.id));
  res.status(204).end();
}