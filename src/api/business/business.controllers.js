import * as businessService from './service/business.service.js';

export async function list(_req, res) {
  res.json(await businessService.list());
}

export async function getBySlug(req, res) {
  res.json({ negocio: await businessService.getBySlug(req.params.slug) });
}