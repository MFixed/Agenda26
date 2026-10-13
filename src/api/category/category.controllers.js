import * as categoryService from './service/category.service.js';
import { createRules, updateRules } from './category.validation.js';

export async function list(req, res) {
  res.json({
    items: await categoryService.list(req.businessId, {
      incluirInactivas: req.query.incluirInactivas === 'true',
    }),
  });
}

export async function detail(req, res) {
  res.json({ categoria: await categoryService.detail(req.businessId, Number(req.params.id)) });
}

export async function create(req, res) {
  res
    .status(201)
    .json({ categoria: await categoryService.create(req.businessId, createRules(req.body), req) });
}

export async function update(req, res) {
  res.json({
    categoria: await categoryService.update(
      req.businessId,
      Number(req.params.id),
      updateRules(req.body),
      req
    ),
  });
}

export async function remove(req, res) {
  await categoryService.remove(req.businessId, Number(req.params.id), req, {
    hard: req.query.hard === 'true',
  });
  res.status(204).end();
}

export default { list, detail, create, update, remove };
