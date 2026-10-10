import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';
import { hashPassword } from '../../../utils/password.js';

const ADMIN_SELECT = {
  id: true,
  nombre: true,
  email: true,
  activo: true,
};

/** Listado publico de empresas: solo las que tienen la puerta abierta. */
export async function list() {
  return prisma.business.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, slug: true, descripcion: true },
  });
}

/**
 * Ficha minima de una empresa por su identificador. Es lo que pinta la puerta
 * de acceso (/b/:slug/login) con el nombre del negocio, asi que responde sin
 * token: quien todavia no ha entrado es justo quien lo necesita.
 */
export async function getBySlug(slug) {
  const negocio = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, nombre: true, slug: true, descripcion: true, activo: true },
  });

  if (!negocio || !negocio.activo) {
    throw ApiError.notFound('No encontramos ningun negocio con ese identificador');
  }

  return negocio;
}

/**
 * Panel de la plataforma: todas las empresas, incluidas las desactivadas, con
 * sus cifras y sus administradores. Quien administra una empresa es lo primero
 * que hace falta cuando se queda sin acceso.
 */
export async function listForSuper() {
  const negocios = await prisma.business.findMany({
    orderBy: { nombre: 'asc' },
    include: {
      users: {
        where: { role: 'ADMIN' },
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
 * Alta de una empresa con su primer administrador. Van en la misma transaccion:
 * una empresa sin administrador se queda con las puertas cerradas y habria que
 * arreglar a mano desde la base de datos.
 */
export async function createWithAdmin({ nombre, slug, descripcion, adminNombre, adminEmail, adminPassword }) {
  const emailNormalizado = adminEmail.toLowerCase();

  if (await prisma.user.findUnique({ where: { email: emailNormalizado }, select: { id: true } })) {
    throw ApiError.conflict('Ese email ya esta registrado');
  }

  const passwordHash = await hashPassword(adminPassword);

  const admin = await prisma.$transaction(async (tx) => {
    const negocio = await tx.business.create({
      data: { nombre, slug, descripcion },
      select: { id: true, nombre: true, slug: true },
    });

    return tx.user.create({
      data: {
        nombre: adminNombre,
        email: emailNormalizado,
        passwordHash,
        role: 'ADMIN',
        businessId: negocio.id,
      },
      select: ADMIN_SELECT,
    });
  });

  const puerta = `/b/${slug}/login`;

  return {
    mensaje: `Negocio creado. Puerta de acceso: ${puerta} · ${adminEmail}`,
    admin,
  };
}

export async function update(id, data) {
  const negocio = await prisma.business.findUnique({ where: { id }, select: { id: true } });

  if (!negocio) {
    throw ApiError.notFound('Negocio no encontrado');
  }

  return prisma.business.update({ where: { id }, data });
}