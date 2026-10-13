import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { auditar } from '../../../utils/audit.js';

/**
 * Las categorias son el catalogo de servicios de una empresa ("SERVICIOS",
 * "Mantenimiento"). En v1 no tenian ninguna logica detras; en v2 cada una lleva su
 * duracion, su color y su precio de referencia, que es lo que permite pintar el
 * calendario sin preguntas y medir la ocupacion por servicio.
 */
export async function list(businessId, { incluirInactivas = false } = {}) {
  const items = await prisma.category.findMany({
    where: { businessId, deletedAt: null, ...(incluirInactivas ? {} : { activo: true }) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { tasks: true } } },
  });

  return items.map(categoriaView);
}

export function categoriaView({ _count, ...categoria }) {
  return {
    ...categoria,
    /// `precio` viene de la base como Decimal (string) para no perder cents.
    /// Se convierte a numero para el frontend; si hace falta mas precision, el
    /// sitio es formatearlo en la vista, no guardarlo como float.
    precio: categoria.precio !== null ? Number(categoria.precio) : null,
    tareas: _count.tasks,
  };
}

export async function detail(businessId, id) {
  const categoria = await prisma.category.findFirst({
    where: { id, businessId, deletedAt: null },
    include: { _count: { select: { tasks: true } } },
  });

  if (!categoria) throw ApiError.notFound('Categoria no encontrada');

  return categoriaView(categoria);
}

export async function create(businessId, data, req) {
  const categoria = await prisma.category.create({ data: { ...data, businessId } });

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'create',
    entity: 'Category',
    entityId: categoria.id,
    req,
  });

  return categoriaView({ ...categoria, _count: { tasks: 0 } });
}

export async function update(businessId, id, data, req) {
  const categoria = await prisma.category.findFirst({
    where: { id, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!categoria) throw ApiError.notFound('Categoria no encontrada');

  const actualizada = await prisma.category.update({
    where: { id },
    data,
    include: { _count: { select: { tasks: true } } },
  });

  auditar({ businessId, actorId: req.user?.id, action: 'update', entity: 'Category', entityId: id, req });

  return categoriaView(actualizada);
}

/**
 * Baja de categoria: logica (soft delete).
 *
 * Las tareas quedan con `categoryId = null` gracias al SET NULL del esquema, asi
 * que no se pierde ninguna. Se marca `deletedAt` en vez de borrar en cascada para
 * que las citas ya hechas conserven el nombre del servicio aunque se desactive.
 *
 * Con `?hard=true` se elimina de verdad, para cuando hay que limpiar de verdad.
 */
export async function remove(businessId, id, req, { hard = false } = {}) {
  const categoria = await prisma.category.findFirst({
    where: { id, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!categoria) throw ApiError.notFound('Categoria no encontrada');

  if (hard) {
    await prisma.category.delete({ where: { id } });
  } else {
    await prisma.category.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
  }

  auditar({ businessId, actorId: req.user?.id, action: 'delete', entity: 'Category', entityId: id, req });
}

export default { list, detail, create, update, remove };
