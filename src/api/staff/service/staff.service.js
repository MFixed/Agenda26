import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { pagination, busquedaTexto } from '../../../utils/pagination.js';
import { auditar } from '../../../utils/audit.js';

const SELECT = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  especialidad: true,
  color: true,
  activo: true,
  _count: { select: { appointments: true, availabilities: true } },
};

const vista = ({ _count, ...staff }) => ({
  ...staff,
  citas: _count.appointments,
  bloques: _count.availabilities,
});

/**
 * Profesionales (nuevo en v2).
 *
 * v1 colgia la cita de la EMPRESA y no de una persona: en una clinica con tres
 * odontologos era imposible pedir cita "con el doctor X", porque el modelo no
 * tenia donde decirlo. Aqui la cita cuelga de un `staffId`.
 *
 * Un profesional puede tener o no una cuenta de usuario (`userId`). Esa es la
 * diferencia con un `STAFF`: un profesional que solo atiende y no administers no
 * necesita entrar al panel.
 */
export async function list(businessId, { q, activo, limit, offset } = {}) {
  const { limit: tomar, offset: saltar } = pagination({ limit, offset });

  const where = {
    businessId,
    deletedAt: null,
    ...(activo === undefined ? {} : { activo }),
    ...busquedaTexto(q, ['nombre', 'especialidad']),
  };

  const [items, total] = await prisma.$transaction([
    prisma.staff.findMany({
      where,
      select: SELECT,
      orderBy: { nombre: 'asc' },
      take: tomar,
      skip: saltar,
    }),
    prisma.staff.count({ where }),
  ]);

  return { items: items.map(vista), total };
}

export async function detail(businessId, id) {
  const staff = await prisma.staff.findFirst({
    where: { id, businessId, deletedAt: null },
    select: SELECT,
  });

  if (!staff) throw ApiError.notFound('Profesional no encontrado');

  return vista(staff);
}

export async function create(businessId, data, req) {
  const staff = await prisma.staff.create({
    data: { businessId, ...data },
    select: SELECT,
  });

  auditar({ businessId, actorId: req.user?.id, action: 'create', entity: 'Staff', entityId: staff.id, req });

  return vista(staff);
}

export async function update(businessId, id, data, req) {
  const existente = await prisma.staff.findFirst({
    where: { id, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!existente) throw ApiError.notFound('Profesional no encontrado');

  const staff = await prisma.staff.update({
    where: { id },
    data: { ...data, ...(data.email ? { email: data.email.toLowerCase() } : {}) },
    select: SELECT,
  });

  auditar({ businessId, actorId: req.user?.id, action: 'update', entity: 'Staff', entityId: id, req });

  return vista(staff);
}

/**
 * Baja logica de un profesional.
 *
 * No se borra en cascada: tiene citas. Marcarlo `deletedAt` lo saca de los
 * listados futuros pero deja el nombre congelado en las citas que ya atendio, que
 * es lo que tiene que pasar cuando alguien deja la clinica.
 */
export async function remove(businessId, id, req) {
  const existente = await prisma.staff.findFirst({
    where: { id, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!existente) throw ApiError.notFound('Profesional no encontrado');

  await prisma.$transaction([
    prisma.staff.update({ where: { id }, data: { deletedAt: new Date(), activo: false } }),
    /// Sus bloques futuros se bloquean en vez de desaparecer: si desaparecieran,
    /// las citas que ya tienen asignadas se quedarian apuntando a un hueco
    /// inexistente.
    prisma.availability.updateMany({
      where: {
        staffId: id,
        deletedAt: null,
        date: { gte: new Date() },
        status: { in: ['AVAILABLE', 'HELD'] },
      },
      data: { status: 'BLOCKED', note: 'Profesional dado de baja' },
    }),
  ]);

  auditar({ businessId, actorId: req.user?.id, action: 'delete', entity: 'Staff', entityId: id, req });
}

export default { list, detail, create, update, remove };
