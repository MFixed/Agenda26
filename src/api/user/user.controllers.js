import * as userService from './service/user.service.js';
import { createRules, updateRules } from './user.validation.js';

export async function list(req, res) {
  res.json(
    await userService.list(req.businessId, {
      q: req.query.q,
      role: req.query.role,
      limit: req.query.limit,
      offset: req.query.offset,
    })
  );
}

export async function detail(req, res) {
  res.json({ usuario: await userService.detail(req.businessId, Number(req.params.id)) });
}

export async function create(req, res) {
  res.status(201).json(await userService.create(req.businessId, createRules(req.body), req));
}

export async function update(req, res) {
  res.json({
    usuario: await userService.update(req.businessId, Number(req.params.id), updateRules(req.body), req),
  });
}

export async function remove(req, res) {
  await userService.remove(req.businessId, Number(req.params.id), req);
  res.status(204).end();
}

export default { list, detail, create, update, remove };
