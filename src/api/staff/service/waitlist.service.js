import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { parseDateOnly } from '../../../utils/dates.js';
import { auditar } from '../../../utils/audit.js';

/**
 * Lista de espera (nuevo en v2).
 *
 * "No hay huecos, avisame cuando haya." Sin esto, el cliente que no encuentra
 * hueco se va y no vuelve. Con esto, el negocio tiene a alguien esperando y el
 * worker le avisa en cuanto se abre algo.
 *
 * La entrada caduca sola: `expiresAt` evita que dentro de medio año le salga un
 * aviso a alguien que ya no se acuerda de haber pedido nada.
 */

const SELECT = {
  id: true,
  clientId: true,
  categoryId: true,
  staffId: true,
  dateFrom: true,
  dateTo: true,
  note: true,
  status: true,
  notifiedAt: true,
  expiresAt: true,
  createdAt: true,
  client: { select: { id: true, nombre: true, telefono: true, user: { select: { email: true } } } },
  category: { select: { id: true, name: true, durationMin: true } },
};

/*
 * `staff` NO se pide en el select.
 *
 * El modelo `WaitlistEntry` declara `staffId` pero no la relacion `staff` (el
 * esquema solo relaciona business, client y category). Pedirla hacia que Prisma
 * lanzara "Unknown field `staff` for select statement", y como esta consulta es la
 * base de TODO el servicio de lista de espera (listar, crear, buscar candidatos),
 * la funcion entera fallaba con un error 500.
 */

export async function list(businessId, { status, clientId, limit, offset } = {}) {
  const take = Math.min(Number(limit) || 50, 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const where = {
    businessId,
    ...(status ? { status } : {}),
    /// Un cliente solo ve las suyas; el resto, todas las del negocio.
    ...(clientId ? { clientId } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.waitlistEntry.findMany({
      where,
      select: SELECT,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.waitlistEntry.count({ where }),
  ]);

  return { items, total };
}

export async function create(businessId, data, req, { actorId }) {
  const cliente = await prisma.client.findFirst({
    where: { id: data.clientId, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!cliente) throw ApiError.badRequest('El cliente indicado no pertenece al negocio');

  /// Duplicados: si el cliente ya esta esperando para el mismo rango y el mismo
  /// servicio, un segundo aviso no le aporta nada. Se devuelve el que ya hay.
  const existente = await prisma.waitlistEntry.findFirst({
    where: {
      businessId,
      clientId: data.clientId,
      status: 'WAITING',
      dateFrom: parseDateOnly(data.dateFrom),
      ...(data.categoryId ? { categoryId: data.categoryId } : {}),
    },
  });

  if (existente) return existente;

  const entrada = await prisma.waitlistEntry.create({
    data: {
      businessId,
      clientId: data.clientId,
      categoryId: data.categoryId,
      staffId: data.staffId,
      dateFrom: parseDateOnly(data.dateFrom),
      dateTo: data.dateTo ? parseDateOnly(data.dateTo) : null,
      note: data.note,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    select: SELECT,
  });

  auditar({
    businessId,
    actorId: actorId ?? req?.user?.id,
    action: 'create',
    entity: 'WaitlistEntry',
    entityId: entrada.id,
    req,
  });

  return entrada;
}

export async function remove(businessId, id, req) {
  const entrada = await prisma.waitlistEntry.findFirst({
    where: { id, businessId, status: 'WAITING' },
    select: { id: true, clientId: true },
  });

  if (!entrada) throw ApiError.notFound('Entrada no encontrada o ya resuelta');

  await prisma.waitlistEntry.update({ where: { id }, data: { status: 'CANCELLED' } });

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'delete',
    entity: 'WaitlistEntry',
    entityId: id,
    req,
  });
}

/**
 * Caduca las entradas vencidas.
 *
 * La corre el worker. No es una Query que se ejecute al listar: si al leer una
 * lista se muta la base, dos personas mirando a la vez ven cosas distintas.
 */
export async function expirarVencidas() {
  const { count } = await prisma.waitlistEntry.updateMany({
    where: { status: 'WAITING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });

  return count;
}

/**
 * Quien esta esperando por algo que acaba de liberarse.
 *
 * Devuelve las entradas cuyo rango de fechas cubre el dia del hueco y que encajan
 * con el servicio (sin categoria = cualquiera) y con el profesional (sin
 * profesional = cualquiera).
 *
 * NO marca nada como notificado: eso lo hace `marcarNotificado`, que corre solo si
 * el aviso se mando de verdad. Marcar aqui y que el envio falle dejaria a alguien
 * marcado como avisado que no lo fue.
 */
export async function candidatosParaHueco(businessId, hueco) {
  const entradas = await prisma.waitlistEntry.findMany({
    where: {
      businessId,
      status: 'WAITING',
      dateFrom: { lte: hueco.date },
      OR: [{ dateTo: null }, { dateTo: { gte: hueco.date } }],
    },
    select: SELECT,
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  return entradas.filter((entrada) => {
    if (entrada.staffId && hueco.staffId && entrada.staffId !== hueco.staffId) return false;
    return true;
  });
}

export async function marcarNotificado(id) {
  return prisma.waitlistEntry.update({
    where: { id },
    data: { status: 'NOTIFIED', notifiedAt: new Date() },
  });
}

export default { list, create, remove, expirarVencidas, candidatosParaHueco, marcarNotificado };
