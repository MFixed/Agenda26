import * as businessService from '../business/service/business.service.js';
import { createRules, updateRules } from '../business/business.regex.js';

/**
 * Panel de la plataforma. Solo agrupa y traduce HTTP: las reglas de una empresa
 * viven en su propio service, que es quien sabe crear negocios y mantener sus
 * datos.
 */

export async function listNegocios(_req, res) {
  res.json({ items: await businessService.listForSuper() });
}

export async function createNegocio(req, res) {
  res.status(201).json(await businessService.createWithAdmin(createRules(req.body)));
}

export async function updateNegocio(req, res) {
  const negocio = await businessService.update(Number(req.params.id), updateRules(req.body));
  res.json({ negocio });
}