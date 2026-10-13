import * as reminderService from './reminder.service.js';

export async function listFor(req, res) {
  res.json({ items: await reminderService.listFor(req.businessId, Number(req.params.id)) });
}

export async function create(req, res) {
  res
    .status(201)
    .json(
      await reminderService.create(
        req.businessId,
        Number(req.params.id),
        reminderService.createRules(req.body),
        req
      )
    );
}

export default { listFor, create };
