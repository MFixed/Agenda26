import { prisma } from "../config/database.js";
import { AppError, conflicto, noEncontrado } from "../utils/http.js";
import { hashPassword } from "../utils/password.js";

/**
 * Gestión de negocios por el equipo de la plataforma (rol SUPERADMIN).
 * Un negocio nuevo se crea con su primer administrador atómicamente: si la
 * cuenta del admin no se puede crear, tampoco nace el negocio.
 */

const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;

export function normalizarSlug(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos tras NFD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * El listado del panel de plataforma. Se cuentan también los usuarios: un
 * negocio sin ningún administrador activo es un negocio cerrado aunque su
 * `activo` diga lo contrario, y desde aquí es donde se ve eso.
 *
 * `usuarios` cuenta todos los roles, no sólo los ADMIN: los CLIENT también son
 * usuarios de la empresa y el panel habla de cuentas, no de empleados.
 *
 * `admins` lleva nombre y correo de los administradores, no sólo un recuento:
 * quien opera la plataforma tiene que saber a quién escribir cuando una empresa
 * se queda sin acceso, y sin el correo no puede hacer nada por ella.
 */
export async function listarNegocios() {
  const negocios = await prisma.business.findMany({
    include: {
      users: { select: { id: true, nombre: true, email: true, role: true, activo: true } },
      _count: { select: { clients: true, appointments: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  return negocios.map((negocio) => {
    const admins = negocio.users.filter((u) => u.role === "ADMIN");
    return {
      id: negocio.id,
      nombre: negocio.nombre,
      slug: negocio.slug,
      descripcion: negocio.descripcion,
      activo: negocio.activo,
      createdAt: negocio.createdAt,
      updatedAt: negocio.updatedAt,
      usuarios: negocio.users.length,
      administradores: admins.filter((u) => u.activo).length,
      admins: admins.map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, activo: u.activo })),
      clientes: negocio._count.clients,
      citas: negocio._count.appointments
    };
  });
}

export async function infoPublica(slug) {
  const negocio = await prisma.business.findUnique({ where: { slug } });
  if (!negocio || !negocio.activo) {
    throw noEncontrado("Ese negocio no existe.");
  }
  return { id: negocio.id, nombre: negocio.nombre, slug: negocio.slug, descripcion: negocio.descripcion };
}

export async function crearNegocio({ nombre, slug, descripcion, admin }) {
  const slugFinal = normalizarSlug(slug || nombre);
  if (!RE_SLUG.test(slugFinal)) {
    throw new AppError(422, "El identificador del negocio no es válido (minúsculas, números y guiones, 2-60).");
  }
  const existente = await prisma.business.findUnique({ where: { slug: slugFinal } });
  if (existente) {
    throw conflicto("Ya existe un negocio con ese identificador.");
  }

  const email = String(admin.email || "").trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw conflicto("Ya existe una cuenta con ese correo electrónico.");
  }
  // Las categorías base nacen con el negocio para que todo funcione desde el
  // primer minuto, igual que en el seed.
  const categorias = [
    { name: "SERVICIOS", description: "Trabajos que se realizan para un cliente." },
    { name: "VENTAS", description: "Presupuestos, ofertas y seguimiento comercial." },
    { name: "COMPRAS", description: "Materiales, suministros y material de oficina." },
    { name: "ADMINISTRACIÓN", description: "Gestión interna, facturación y papeleo." },
    { name: "MANTENIMIENTO", description: "Revisiones y reparaciones." },
    { name: "OTROS", description: "Lo que todavía no tiene categoría." }
  ];

  /* El alta es una sola operación: negocio, administrador y categorías base.
     Las escrituras anidadas de Prisma van en una transacción, así que si la
     cuenta del administrador no se puede crear tampoco queda un negocio a medias
     —sin nadie que lo administre. De ahí el "atómicamente" del comentario de
     arriba: no hay que envolverlo en enTransaccion(), ya lo hace el anidado. */
  const negocio = await prisma.business.create({
    data: {
      nombre,
      slug: slugFinal,
      descripcion: descripcion || null,
      users: {
        create: {
          nombre: admin.nombre,
          email,
          passwordHash: await hashPassword(admin.password),
          role: "ADMIN"
        }
      },
      categories: { create: categorias }
    },
    include: { users: true }
  });

  return negocio;
}

/**
 * Activar o desactivar una empresa. No borra nada: sólo cierra sus puertas, y
 * todo lo que tiene dentro se conserva por si vuelve a activarse.
 *
 * Al desactivar no se tocan las cuentas. Es lo correcto para una medida
 * administrativa —el cliente ve "tu negocio está desactivado" y sabe a quién
 * dirigirse—, pero deja un caso sin salida: una empresa desactivada con su
 * último administrador también desactivado no tiene a nadie que la vuelva a
 * activar. Por eso se avisa antes: desactivar es reversible desde aquí, por
 * alguien de la plataforma.
 */
export async function cambiarEstadoNegocio(id, activo) {
  const negocio = await prisma.business.findUnique({
    where: { id },
    include: { users: { select: { id: true, role: true, activo: true } } }
  });
  if (!negocio) {
    throw noEncontrado("El negocio no existe.");
  }

  if (!activo) {
    const adminsActivos = negocio.users.filter((usuario) => usuario.role === "ADMIN" && usuario.activo);
    if (adminsActivos.length === 0) {
      throw conflicto("Esta empresa no tiene ningún administrador activo. Reactívalos antes de desactivarla.");
    }
  }

  return prisma.business.update({ where: { id }, data: { activo } });
}
