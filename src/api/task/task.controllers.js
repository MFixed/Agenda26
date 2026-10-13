import * as taskService from './service/task.service.js';
import { createRules, listFilters, updateRules } from './task.validation.js';

export async function list(req, res) {
  res.json(await taskService.list(req.user, req.businessId, listFilters(req.query), req.business?.timezone));
}

export async function getById(req, res) {
  res.json({
    tarea: await taskService.detail(req.user, req.businessId, Number(req.params.id), req.business?.timezone),
  });
}

export async function create(req, res) {
  res
    .status(201)
    .json({ tarea: await taskService.create(req.user, req.businessId, createRules(req.body), req) });
}

export async function update(req, res) {
  res.json({
    tarea: await taskService.update(
      req.user,
      req.businessId,
      Number(req.params.id),
      updateRules(req.body),
      req
    ),
  });
}

export async function remove(req, res) {
  await taskService.remove(req.user, req.businessId, Number(req.params.id), req, {
    hard: req.query.hard === 'true',
  });
  res.status(204).end();
}

export default { list, getById, create, update, remove };
