import * as businessService from './service/business.service.js';
import { createRules, updateRules } from './business.validation.js';

export async function list(_req, res) {
  res.json(await businessService.list());
}

export async function getBySlug(req, res) {
  res.json({ negocio: await businessService.getBySlug(req.params.slug) });
}

/* --- Panel de la plataforma (SUPERADMIN) --- */

export async function listNegocios(_req, res) {
  res.json({ items: await businessService.listForSuper() });
}

export async function createNegocio(req, res) {
  res.status(201).json(await businessService.createWithAdmin(createRules(req.body), req));
}

export async function updateNegocio(req, res) {
  res.json({ negocio: await businessService.update(Number(req.params.id), updateRules(req.body)) });
}

export async function deleteNegocio(req, res) {
  await businessService.remove(Number(req.params.id), { hard: req.query.hard === 'true' });
  res.status(204).end();
}

/* --- Ajustes de la empresa --- */

export async function getSettings(req, res) {
  res.json({ settings: await businessService.getSettings(req.businessId) });
}

export async function updateSettings(req, res) {
  res.json({ settings: await businessService.updateSettings(req.businessId, req.body) });
}

export default {
  list,
  getBySlug,
  listNegocios,
  createNegocio,
  updateNegocio,
  deleteNegocio,
  getSettings,
  updateSettings,
};
