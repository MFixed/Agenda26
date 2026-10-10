import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';

/**
 * Las categorias son el catalogo de servicios de una empresa ("SERVICIOS",
 * "Mantenimiento"). Solo las usa el frontend para etiqueta y agrupacion: no
 * llevan ninguna logica detras.
 */
export async function list(businessId) {
  const items = await prisma.category.findMany({
    where: { businessId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { tasks: true } } },
  });

  return items.map(categoriaView);
}

export function categoriaView({ _count, ...categoria }) {
  return { ...categoria, tareas: _count.tasks };
}

export async function create(businessId, data) {
  const categoria = await prisma.category.create({ data: { ...data, businessId } });
  return categoriaView({ ...categoria, _count: { tasks: 0 } });
}

export async function getById(businessId, id) {
  const categoria = await prisma.category.findFirst({
    where: { id, businessId },
    include: { _count: { select: { tasks: true } } },
  });

  if (!categoria) {
    throw ApiError.notFound('Categoria no encontrada');
  }

  return categoria;
}

export async function update(businessId, id, data) {
  await getById(businessId, id);

  const categoria = await prisma.category.update({
    where: { id },
    data,
    include: { _count: { select: { tasks: true } } },
  });

  return categoriaView(categoria);
}

export async function remove(businessId, id) {
  await getById(businessId, id);

  // Las tareas quedan con categoryId = null gracias a onDelete: SetNull.
  await prisma.category.delete({ where: { id } });
}