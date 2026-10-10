import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';
import { formatDateOnly, hoyLocal, parseDateOnly } from '../../../utils/dates.js';
import { pagination } from '../../../utils/pagination.js';

const INCLUDE = {
  _count: { select: { appointments: true } },
};

/** Rangos que ocupan agenda: no se pueden pisar. */
const BLOQUEAN = ['AVAILABLE', 'HELD', 'RESERVED'];

/** "09:00" < "10:00" funciona como texto: los dos tienen el mismo formato. */
function solapa(startTime, endTime, inicio, fin) {
  return startTime < fin && endTime > inicio;
}

/** El dia se devuelve como texto: es lo que espera <input type="date">. */
function huecoView({ date, _count, ...hueco }) {
  return { ...hueco, date: formatDateOnly(date), citas: _count.appointments };
}

export async function list(businessId, filters = {}) {
  const { limit, offset } = pagination(filters);

  const [items, total] = await prisma.$transaction([
    prisma.availability.findMany({
      where: {
        businessId,
        ...(filters.desde ? { date: { gte: parseDateOnly(filters.desde) } } : {}),
        ...(filters.hasta ? { date: { lte: parseDateOnly(filters.hasta) } } : {}),
        ...(filters.estado ? { status: filters.estado } : {}),
      },
      include: INCLUDE,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.availability.count({
      where: {
        businessId,
        ...(filters.desde ? { date: { gte: parseDateOnly(filters.desde) } } : {}),
        ...(filters.hasta ? { date: { lte: parseDateOnly(filters.hasta) } } : {}),
        ...(filters.estado ? { status: filters.estado } : {}),
      },
    }),
  ]);

  return { items: items.map(huecoView), total };
}

/**
 * El cliente solo ve lo que puede reservar y solo hacia adelante: un hueco ya
 * pasado no sirve para nada y uno reservado no debe lacear a otros.
 */
export function filtersForClient(query) {
  return {
    estado: 'AVAILABLE',
    desde: query.desde || hoyLocal(),
    hasta: query.hasta,
  };
}

export async function getById(businessId, id) {
  const hueco = await prisma.availability.findFirst({ where: { id, businessId }, include: INCLUDE });

  if (!hueco) {
    throw ApiError.notFound('Horario no encontrado');
  }

  return hueco;
}

export async function detail(businessId, id) {
  return huecoView(await getById(businessId, id));
}

export async function create(businessId, data) {
  const date = parseDateOnly(data.date);

  await assertNoOverlap(businessId, date, data.startTime, data.endTime);

  const hueco = await prisma.availability.create({
    data: { ...data, businessId, date },
    include: INCLUDE,
  });

  return huecoView(hueco);
}

export async function update(businessId, id, data) {
  const hueco = await getById(businessId, id);

  const date = data.date === undefined ? hueco.date : parseDateOnly(data.date);
  const startTime = data.startTime ?? hueco.startTime;
  const endTime = data.endTime ?? hueco.endTime;

  if (startTime >= endTime) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'startTime', message: 'La hora de inicio debe ser anterior a la de fin' },
    ]);
  }

  // Un horario reservado con citas vivas no se libera a mano: el servicio de
  // citas es el unico que devuelve el hueco a AVAILABLE.
  if (hueco.status === 'RESERVED' && data.status === 'AVAILABLE') {
    const activas = await prisma.appointment.count({
      where: { availabilityId: id, status: { in: ['PENDING', 'COORDINATED'] } },
    });

    if (activas > 0) {
      throw ApiError.conflict('No puedes liberar un horario con citas activas');
    }
  }

  // Solo se comprueban solapamientos si el hueco sigue reservando agenda: uno
  // bloqueado no estorba a los demas.
  if (data.status !== 'BLOCKED' && hueco.status !== 'BLOCKED') {
    await assertNoOverlap(businessId, date, startTime, endTime, id);
  }

  const actualizado = await prisma.availability.update({
    where: { id },
    data: { ...data, date },
    include: INCLUDE,
  });

  return huecoView(actualizado);
}

/**
 * Borrar un horario con citas encima dejaria citas apuntando a un hueco que ya
 * no existe, asi que se rechaza en vez de dejarlo al cascada.
 */
export async function remove(businessId, id) {
  const hueco = await getById(businessId, id);

  if (hueco._count.appointments > 0) {
    throw ApiError.conflict('No puedes eliminar un horario que tiene citas');
  }

  await prisma.availability.delete({ where: { id } });
}

/**
 * Dos intervalos se solapan si el inicio de uno es anterior al fin del otro.
 * Se traen los rangos bloqueantes de ese dia y se comparan en memoria: son unos
 * pocos, y no hace falta disjuntar el filtro por cada combinacion de horas.
 */
async function assertNoOverlap(businessId, date, startTime, endTime, excludeId) {
  const existentes = await prisma.availability.findMany({
    where: {
      businessId,
      date,
      status: { in: BLOQUEAN },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });

  const choque = existentes.find((otro) => solapa(startTime, endTime, otro.startTime, otro.endTime));

  if (choque) {
    throw ApiError.conflict(`El horario se solapa con otro ya publicado (${choque.startTime} - ${choque.endTime})`);
  }
}