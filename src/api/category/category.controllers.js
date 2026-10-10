import * as categoryService from './service/category.service.js';
import { createRules, updateRules } from './category.regex.js';
import { resolveBusinessId } from '../../middlewares/auth.js';

export async function list(req, res) {
  res.json({ items: await categoryService.list(resolveBusinessId(req)) });
}

export async function create(req, res) {
  res.status(201).json({ categoria: await categoryService.create(resolveBusinessId(req), createRules(req.body)) });
}

export async function update(req, res) {
  const businessId = resolveBusinessId(req);
  res.json({ categoria: await categoryService.update(businessId, Number(req.params.id), updateRules(req.body)) });
}

export async function remove(req, res) {
  await categoryService.remove(resolveBusinessId(req), Number(req.params.id));
  res.status(204).end();
}