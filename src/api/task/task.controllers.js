import * as taskService from './service/task.service.js';
import { createRules, listFilters, updateRules } from './task.regex.js';
import { resolveBusinessId } from '../../middlewares/auth.js';

export async function list(req, res) {
  res.json(await taskService.list(req.user, resolveBusinessId(req), listFilters(req.query)));
}

export async function getById(req, res) {
  res.json({ tarea: await taskService.detail(req.user, resolveBusinessId(req), Number(req.params.id)) });
}

export async function create(req, res) {
  const tarea = await taskService.create(req.user, resolveBusinessId(req), createRules(req.body));
  res.status(201).json({ tarea });
}

export async function update(req, res) {
  const tarea = await taskService.update(req.user, resolveBusinessId(req), Number(req.params.id), updateRules(req.body));
  res.json({ tarea });
}

export async function remove(req, res) {
  await taskService.remove(req.user, resolveBusinessId(req), Number(req.params.id));
  res.status(204).end();
}