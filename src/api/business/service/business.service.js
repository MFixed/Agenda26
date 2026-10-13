import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { hashPassword } from '../../../utils/password.js';
import { zonaValida } from '../../../utils/dates.js';

const ADMIN_SELECT = {
  id: true,
  nombre: true,
  email: true,
  activo: true,
};

/** Listado publico de empresas: solo las que tienen la puerta abierta. */
export async function list() {
  return prisma.business.findMany({
    where: { activo: true, deletedAt: null },
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, slug: true, descripcion: true },
  });
}

/**
 * Ficha minima de una empresa por su identificador. Es lo que pinta la puerta de
 * acceso (/b/:slug/login) con el nombre del negocio, asi que responde sin token:
 * quien todavia no ha entrado es justo quien lo necesita.
 */
export async function getBySlug(slug) {
  const negocio = await prisma.business.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, nombre: true, slug: true, descripcion: true, activo: true, timezone: true },
  });

  if (!negocio || !negocio.activo) {
    throw ApiError.notFound('No encontramos ningun negocio con ese identificador');
  }

  return negocio;
}

/**
 * Panel de la plataforma: todas las empresas, incluidas las desactivadas, con sus
 * cifras y sus administradores. Quien administra una empresa es lo primero que
 * hace falta cuando se queda sin acceso.
 */
export async function listForSuper() {
  const negocios = await prisma.business.findMany({
    where: { deletedAt: null },
    orderBy: { nombre: 'asc' },
    include: {
      users: {
        where: { role: { in: ['ADMIN', 'STAFF'] }, deletedAt: null },
        select: ADMIN_SELECT,
        orderBy: { nombre: 'asc' },
      },
      _count: { select: { users: true, clients: true, appointments: true } },
    },
  });

  return negocios.map(({ _count, users, ...negocio }) => ({
    ...negocio,
    admins: users,
    usuarios: _count.users,
    clientes: _count.clients,
    citas: _count.appointments,
  }));
}

/**
 * Alta de una empresa con su primer administrador. Van en la misma transaccion: una
 * empresa sin administrador se queda con las puertas cerradas y habria que
 * arreglar a mano desde la base de datos.
 */
export async function createWithAdmin(
  { nombre, slug, descripcion, timezone, bufferMin, slotMinutes, adminNombre, adminEmail, adminPassword },
  _req
) {
  const emailNormalizado = adminEmail.toLowerCase();

  if (await prisma.user.findUnique({ where: { email: emailNormalizado }, select: { id: true } })) {
    throw ApiError.conflict('Ese email ya esta registrado');
  }

  const z = timezone ?? 'UTC';

  if (!zonaValida(z)) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'timezone', message: 'La zona horaria no es valida' },
    ]);
  }

  const admin = await prisma.$transaction(async (tx) => {
    const negocio = await tx.business.create({
      data: {
        nombre,
        slug,
        descripcion,
        timezone: z,
        bufferMin: bufferMin ?? 0,
        slotMinutes: slotMinutes ?? 60,
      },
      select: { id: true, nombre: true, slug: true },
    });

    const creado = await tx.user.create({
      data: {
        nombre: adminNombre,
        email: emailNormalizado,
        passwordHash: await hashPassword(adminPassword),
        role: 'ADMIN',
        businessId: negocio.id,
      },
      select: ADMIN_SELECT,
    });

    // Los ajustes nacen con la empresa: es lo que permite que el service de
    // agenda lea `req.business.settings.holdMinutes` sin defenderse de un null.
    await tx.businessSettings.create({ data: { businessId: negocio.id } });

    return creado;
  });

  const puerta = `/b/${slug}/login`;

  return {
    mensaje: `Negocio creado. Puerta de acceso: ${puerta} · ${adminEmail}`,
    admin,
  };
}

export async function update(id, data) {
  const negocio = await prisma.business.findFirst({ where: { id, deletedAt: null }, select: { id: true } });

  if (!negocio) {
    throw ApiError.notFound('Negocio no encontrado');
  }

  return prisma.business.update({ where: { id }, data });
}

/**
 * Baja de una empresa.
 *
 * v2 la hace logica (soft delete) en vez de fisica. En cascada, borrar una
 * empresa se lleva clientes, cuentas, citas e historiales enteros, y no hay forma
 * de recuperarlos: una cuenta que se lleva su ejemplo de la cartera y sus mil
 * citas hacia detras no se puede deshacer con un DELETE de mas.
 *
 * Se marca `deletedAt` y se oculta de todas las consultas. Los datos siguen ahi,
 * por si hay que volver atras.
 */
export async function remove(id, { hard = false } = {}) {
  const negocio = await prisma.business.findFirst({ where: { id, deletedAt: null }, select: { id: true } });

  if (!negocio) {
    throw ApiError.notFound('Negocio no encontrado');
  }

  if (hard) {
    return prisma.business.delete({ where: { id } });
  }

  return prisma.$transaction([
    prisma.business.update({ where: { id }, data: { deletedAt: new Date(), activo: false } }),
    /// Las cuentas de la empresa se desactivan tambien. Si solo se marca el
    /// negocio, sus usuarios siguen pudiendo entrar con un token que aun no ha
    /// caducado.
    prisma.user.updateMany({
      where: { businessId: id, deletedAt: null },
      data: { activo: false, tokenVersion: { increment: 1 } },
    }),
  ]);
}

export async function getSettings(businessId) {
  return prisma.businessSettings.upsert({
    where: { businessId },
    create: { businessId },
    update: {},
    select: {
      holdMinutes: true,
      reminderBeforeMin: true,
      remindersEnabled: true,
      emailEnabled: true,
      whatsappEnabled: true,
      updatedAt: true,
    },
  });
}

export async function updateSettings(businessId, data) {
  return prisma.businessSettings.upsert({
    where: { businessId },
    create: { businessId, ...data },
    update: data,
    select: {
      holdMinutes: true,
      reminderBeforeMin: true,
      remindersEnabled: true,
      emailEnabled: true,
      whatsappEnabled: true,
      updatedAt: true,
    },
  });
}

export default {
  list,
  getBySlug,
  listForSuper,
  createWithAdmin,
  update,
  remove,
  getSettings,
  updateSettings,
};
