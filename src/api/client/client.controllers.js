import * as clientService from './service/client.service.js';
import { createRules, selfRules, updateRules } from './client.regex.js';
import { resolveBusinessId } from '../../middlewares/auth.js';
import { ApiError } from '../../utils/errorHandler.js';

export async function list(req, res) {
  // El listado completo es una herramienta de trabajo de la administracion: un
  // cliente no puede ver la cartera de la empresa.
  if (req.user.role === 'CLIENT') {
    throw ApiError.forbidden('No tienes permisos para esta accion');
  }

  res.json(await clientService.list(resolveBusinessId(req), {
    q: req.query.q,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
}

export async function getSelf(req, res) {
  res.json({ cliente: await clientService.getSelf(req.user) });
}

export async function updateSelf(req, res) {
  res.json({ cliente: await clientService.updateSelf(req.user, selfRules(req.body)) });
}

export async function getById(req, res) {
  res.json({ cliente: await clientService.detail(resolveBusinessId(req), Number(req.params.id)) });
}

export async function create(req, res) {
  const respuesta = await clientService.create(resolveBusinessId(req), createRules(req.body));
  res.status(201).json(respuesta);
}

export async function update(req, res) {
  res.json({
    cliente: await clientService.update(resolveBusinessId(req), Number(req.params.id), updateRules(req.body)),
  });
}

export async function remove(req, res) {
  await clientService.remove(resolveBusinessId(req), Number(req.params.id));
  res.status(204).end();
}