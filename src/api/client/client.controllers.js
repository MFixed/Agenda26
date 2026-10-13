import * as clientService from './service/client.service.js';
import { createRules, selfRules, updateRules } from './client.validation.js';
import { ApiError } from '../../utils/ApiError.js';

export async function list(req, res) {
  /**
   * El listado completo es una herramienta de trabajo de la administracion: un
   * cliente no puede ver la cartera de la empresa.
   */
  if (req.user.role === 'CLIENT') {
    throw ApiError.forbidden('No tienes permisos para esta accion');
  }

  res.json(
    await clientService.list(req.businessId, {
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
      cursor: req.query.cursor,
    })
  );
}

export async function getSelf(req, res) {
  res.json({ cliente: await clientService.getSelf(req.user) });
}

export async function updateSelf(req, res) {
  res.json({ cliente: await clientService.updateSelf(req.user, selfRules(req.body), req) });
}

export async function getById(req, res) {
  res.json({ cliente: await clientService.detail(req.businessId, Number(req.params.id)) });
}

/** Historial del cliente (nuevo en v2): sus citas con fecha, servicio y estado. */
export async function history(req, res) {
  res.json(await clientService.history(req.businessId, Number(req.params.id), { limite: req.query.limite }));
}

export async function create(req, res) {
  res.status(201).json(await clientService.create(req.businessId, createRules(req.body), req));
}

export async function update(req, res) {
  res.json({
    cliente: await clientService.update(req.businessId, Number(req.params.id), updateRules(req.body), req),
  });
}

export async function remove(req, res) {
  await clientService.remove(req.businessId, Number(req.params.id), req, { hard: req.query.hard === 'true' });
  res.status(204).end();
}

export default { list, getSelf, updateSelf, getById, history, create, update, remove };
