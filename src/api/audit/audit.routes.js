import { Router } from 'express';
import { prisma } from '../../../config/driver.js';
import { ApiError } from '../../utils/ApiError.js';
import { pagination } from '../../utils/pagination.js';
import { authenticate, requireRole, withBusiness } from '../../middlewares/auth.js';

/**
 * Deserializa el payload antes de devolverlo.
 *
 * En la base esta como TEXT porque SQLite no tiene columna JSON. Si se mandara en
 * crudo, el frontend recibiria una cadena donde espera un objeto y tendria que
 * hacer el `JSON.parse` en cada pantalla, con el riesgo de que se le olvide en una.
 * La conversion se hace una vez, aqui, y el cliente recibe siempre lo mismo que
 * recibiria de cualquier otra base.
 */
function leer(items) {
  return items.map((item) => {
    let payload = null;

    if (item.payload) {
      try {
        payload = JSON.parse(item.payload);
      } catch {
        /// Una fila corrupta no debe tumbar la pantalla entera del audit log.
        payload = { error: 'payload ilegible' };
      }
    }

    const { payload: _crudo, ...visible } = item;

    return { ...visible, payload };
  });
}

/**
 * Auditoria (nuevo en v2).
 *
 * v1 solo guardaba los cambios de estado de las citas (`AppointmentEvent`). Quien
 * cambio el precio de un servicio, quien borro un cliente o quien toco los ajustes
 * del negocio no dejaba rastro: no habia forma de responder a "¿quien cambio esto?".
 *
 * Aqui queda todo en `AuditLog`. Es de SOLO LECTURA: no hay endpoint para escribirla
 * a mano ni para borrarla. Se escribe desde `utils/audit.js`, que llama al service
 * cuando algo cambia de verdad.
 *
 * Un log que se puede editar no vale como log.
 */
export const auditRouter = Router();

auditRouter.use(authenticate, requireRole('ADMIN', 'SUPERADMIN'), withBusiness);

auditRouter.get('/', async (req, res) => {
  const { limit, offset } = pagination(req.query);

  const where = {
    businessId: req.businessId,
    ...(req.query.entity ? { entity: req.query.entity } : {}),
    ...(req.query.entityId ? { entityId: Number(req.query.entityId) } : {}),
    ...(req.query.action ? { action: req.query.action } : {}),
    ...(req.query.actorId ? { actorId: Number(req.query.actorId) } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, nombre: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ items: leer(items), total });
});

/**
 * Rastro de una entidad concreta.
 *
 * Ruta aparte porque es el caso de uso real: "dime todo lo que le ha pasado a este
 * cliente". Montarlo con filtros sobre el listado obliga al frontend a traer medio
 * log y filtrar en el cliente.
 */
auditRouter.get('/:entity/:entityId', async (req, res) => {
  const entityId = Number(req.params.entityId);

  if (!Number.isInteger(entityId)) throw ApiError.badRequest('entityId debe ser un numero');

  const { limit, offset } = pagination(req.query);

  const where = { businessId: req.businessId, entity: req.params.entity, entityId };

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, nombre: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ items: leer(items), total });
});

export default auditRouter;
