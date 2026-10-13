import { randomBytes } from 'node:crypto';
import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { hashPassword } from '../../../utils/password.js';
import { pagination, busquedaTexto } from '../../../utils/pagination.js';
import { auditar } from '../../../utils/audit.js';
import { omitir } from '../../../utils/validation.js';

const SELECT = {
  id: true,
  nombre: true,
  email: true,
  role: true,
  activo: true,
  ultimoAcceso: true,
  businessId: true,
  client: { select: { id: true, _count: { select: { appointments: true } } } },

  /// El mismo contador por el lado del profesional: un STAFF tiene ficha de `Staff`
  /// y de ahi cuelgan las citas que le han asignado.
  staff: {
    select: { id: true, nombre: true, especialidad: true, _count: { select: { appointments: true } } },
  },

  /*
   * Las citas NO se cuentan aqui, y el motivo merece explicacion.
   *
   * `User` no tiene relacion con `Appointment`: una cita cuelga de `Client` (si es
   * de un cliente) y de `Staff` (si se asigno a un profesional). Pedir
   * `_count: { appointments }` sobre `User` hace que Prisma lance un
   * ValidationError y la API devuelva un 500. Lo que se cuenta son las relaciones que
   * User SI tiene: notificaciones e historial de cambios.
   *
   * Para un CLIENT, el numero de citas se saca de su ficha, que es de donde cuelgan
   * de verdad (ver más abajo).
   */
  _count: { select: { notifications: true, events: true } },
};

/** Las citas de un usuario, contadas desde donde cuelgan de verdad. */
function citasDe(usuario) {
  const deCliente = usuario.client?._count?.appointments ?? 0;
  const deStaff = usuario.staff?._count?.appointments ?? 0;

  return deCliente + deStaff;
}

/**
 * Cuentas del negocio (nuevo en v2).
 *
 * Se listan admins, staff y clientes juntos porque la pantalla que lo usa es "la
 * gente de esta empresa", no "los administradores". Cada uno trae su rol y el
 * frontend decide que columnas pintar.
 */
export async function list(businessId, { q, role, limit, offset } = {}) {
  const { limit: tomar, offset: saltar } = pagination({ limit, offset });

  const where = {
    businessId,
    deletedAt: null,
    ...(role ? { role } : {}),
    ...busquedaTexto(q, ['nombre', 'email']),
  };

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: SELECT,
      orderBy: [{ role: 'asc' }, { nombre: 'asc' }],
      take: tomar,
      skip: saltar,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map(({ _count, staff, ...user }) => ({ ...user, staff, citas: _count.appointments })),
    total,
  };
}

/**
 * Alta de una cuenta de negocio.
 *
 * Un ADMIN se crea sin ficha de cliente: administra la empresa. Un STAFF puede
 * llevar ficha de profesional (para que se le pueda asignar una cita). Un CLIENT
 * SIEMPRE lleva ficha, porque sin ella no tiene panel ni historial.
 */
export async function create(businessId, data, req) {
  const email = data.email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw ApiError.conflict('Ese email ya esta registrado');
  }

  const esTemporal = !data.password;
  const clave = data.password || `Cli-${randomBytes(5).toString('hex')}`;

  const user = await prisma.$transaction(async (tx) => {
    const creado = await tx.user.create({
      data: {
        nombre: data.nombre,
        email,
        passwordHash: await hashPassword(clave),
        role: data.role,
        businessId,
      },
      select: SELECT,
    });

    if (data.role === 'CLIENT') {
      await tx.client.create({
        data: {
          userId: creado.id,
          businessId,
          nombre: data.nombre,
          telefono: data.telefono ?? null,
        },
      });
    }

    if (data.role === 'STAFF') {
      // Un STAFF con ficha de profesional se engancha a una que ya exista (por
      // ejemplo, el mismo profesional que ya atendia sin tener cuenta).
      await tx.staff.create({
        data: {
          businessId,
          userId: creado.id,
          nombre: data.nombre,
          telefono: data.telefono ?? null,
        },
      });
    }

    await tx.userSettings.create({ data: { userId: creado.id } });

    return creado;
  });

  auditar({ businessId, actorId: req.user?.id, action: 'create', entity: 'User', entityId: user.id, req });

  const { _count, ...limpio } = user;

  return { user: limpio, ...(esTemporal ? { passwordTemporal: clave } : {}) };
}

export async function detail(businessId, id) {
  const user = await prisma.user.findFirst({
    where: { id, businessId, deletedAt: null },
    select: SELECT,
  });

  if (!user) throw ApiError.notFound('Usuario no encontrado');

  const limpio = omitir(user, '_count', 'client', 'staff');

  return { ...limpio, notificaciones: user._count.notifications, citas: citasDe(user) };
}

/**
 * Edicion de una cuenta.
 *
 * El rol SI se puede cambiar, pero no por el propio usuario ni sobre el ultimo
 * admin del negocio: dejar la empresa sin nadie con permisos seria dejar la
 * puerta cerrada con llave por dentro.
 */
export async function update(businessId, id, data, req) {
  const actual = await prisma.user.findFirst({ where: { id, businessId, deletedAt: null }, select: SELECT });

  if (!actual) throw ApiError.notFound('Usuario no encontrado');

  if (data.role && data.role !== actual.role) {
    await verificarNoDejaSinAdmin(businessId, actual);
  }

  /// `password` sale de `data` a proposito: no es una columna, se guarda como
  /// `passwordHash`. Si se extendiera, el update fallaria con un error de Prisma
  /// sobre un campo que no existe.
  const password = data.password;
  const cuenta = omitir(data, 'password');

  const actualizado = await prisma.user.update({
    where: { id },
    data: {
      ...cuenta,
      ...(cuenta.email ? { email: cuenta.email.toLowerCase() } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    },
    select: SELECT,
  });

  auditar({ businessId, actorId: req.user?.id, action: 'update', entity: 'User', entityId: id, req });

  const limpio = omitir(actualizado, '_count', 'client', 'staff');

  return { ...limpio, notificaciones: actualizado._count.notifications, citas: citasDe(actualizado) };
}

/** Desactiva una cuenta y tira sus sesiones. No borra: la baja es logica. */
export async function remove(businessId, id, req) {
  const usuario = await prisma.user.findFirst({
    where: { id, businessId, deletedAt: null, role: { not: 'SUPERADMIN' } },
    select: { id: true, role: true },
  });

  if (!usuario) throw ApiError.notFound('Usuario no encontrado');

  if (id === req.user?.id) {
    throw ApiError.badRequest('No puedes desactivar tu propia cuenta');
  }

  await verificarNoDejaSinAdmin(businessId, { id, role: usuario.role });

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { activo: false, deletedAt: new Date(), tokenVersion: { increment: 1 } },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  auditar({ businessId, actorId: req.user?.id, action: 'delete', entity: 'User', entityId: id, req });
}

/**
 * No dejar la empresa sin administradores.
 *
 * Sin este control, desactivar (o degradar a CLIENT) al unico admin deja la
 * empresa con las puertas cerradas: solo el SUPERADMIN podria arreglarlo, y
 * para eso hace faltacalar por consola. Es un error de un clic que no tiene
 * vuelta atras, asi que se bloquea aqui.
 */
async function verificarNoDejaSinAdmin(businessId, objetivo) {
  if (objetivo.role !== 'ADMIN') return;

  /*
   * `prisma.user.count(...)` devuelve un NUMERO, no `{ count: n }`.
   *
   * Escribir `const { count } = await prisma.user.count(...)` desestructuraba un
   * numero: `count` quedaba en `undefined`, la comparacion `undefined === 0` era
   * falsa y esta guarda NO SE DISPARABA NUNCA. El sintoma era una empresa que se
   * quedaba sin administradores sin decir nada, que es justo lo que la guarda existe
   * para evitar. Es el fallo mas caro del sistema: silencioso y sin vuelta atras.
   *
   * Para pedir un `{ count }` hay que usar `aggregate({ _count })`; `updateMany` y
   * `deleteMany` si lo devuelven.
   */
  const otrosAdmins = await prisma.user.count({
    where: { businessId, role: 'ADMIN', activo: true, deletedAt: null, id: { not: objetivo.id } },
  });

  if (dejaSinAdmin(otrosAdmins)) {
    throw ApiError.conflict(
      'La empresa se quedaria sin ningun administrador. Crea otro antes de cambiar este.'
    );
  }
}

/**
 * La REGLA de la guarda, sin base de datos.
 *
 * Vive separada del `count` a proposito: es la parte que se puede probar sin
 * levantar Prisma, y es exactamente donde estuvo el fallo (comparar un valor que
 * no era un numero). Si la decision volviera a meterse en la funcion que consulta,
 * el test volveria a estar probando una copia de la logica en lugar de la logica.
 *
 * @param {number} otrosAdmins cuantos administradores activos quedan sin contar el
 *   que se esta degradando.
 * @returns {boolean} `true` si el cambio dejaria la empresa sin ninguno.
 */
export function dejaSinAdmin(otrosAdmins) {
  return otrosAdmins === 0;
}

export default { list, create, detail, update, remove, dejaSinAdmin };
