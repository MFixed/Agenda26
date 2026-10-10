import { randomBytes } from 'node:crypto';
import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';
import { hashPassword } from '../../../utils/password.js';
import { formatDateOnly, parseDateOnly } from '../../../utils/dates.js';
import { pagination } from '../../../utils/pagination.js';
import { liberarHuecos } from '../../appointment/service/appointment.service.js';

const INCLUDE = {
  user: { select: { id: true, email: true, activo: true, ultimoAcceso: true } },
  _count: { select: { appointments: true, tasks: true } },
};

/** Anios cumplidos a dia de hoy. El frontend lo pinta junto a la fecha. */
function edadDe(fechaNacimiento) {
  if (!fechaNacimiento) {
    return null;
  }

  const hoy = new Date();
  let edad = hoy.getFullYear() - fechaNacimiento.getFullYear();
  const yaCumpleEsteAnio =
    hoy.getMonth() > fechaNacimiento.getMonth() ||
    (hoy.getMonth() === fechaNacimiento.getMonth() && hoy.getDate() >= fechaNacimiento.getDate());

  if (!yaCumpleEsteAnio) {
    edad -= 1;
  }

  return edad >= 0 ? edad : null;
}

/**
 * La ficha tal como la pintan las pantallas. El email y el estado de la cuenta
 * salen del usuario, no del cliente: no se guardan dos veces.
 */
function fichaView({ user, _count, fechaNacimiento, ...ficha }) {
  return {
    ...ficha,
    fechaNacimiento: formatDateOnly(fechaNacimiento),
    edad: edadDe(fechaNacimiento),
    email: user.email,
    activo: user.activo,
    ultimoAcceso: user.ultimoAcceso,
    citas: _count.appointments,
    tareas: _count.tasks,
  };
}

/**
 * Contrasena temporal para un alta sin clave. Se devuelve una sola vez, en la
 * respuesta del alta: es lo unico que la administracion puede entregar al
 * cliente y despues ya no se puede leer.
 */
function generarPasswordTemporal() {
  return `Cli-${randomBytes(5).toString('hex')}`;
}

export async function list(businessId, { q, limit, offset } = {}) {
  const { limit: tomar, offset: saltar } = pagination({ limit, offset });
  const texto = String(q || '').trim();

  const where = {
    businessId,
    // El correo vive en el usuario, asi que buscarlo tiene que entrar por la
    // relacion en lugar de por un campo de la ficha.
    ...(texto
      ? {
          OR: [
            { nombre: { contains: texto } },
            { documento: { contains: texto } },
            { telefono: { contains: texto } },
            { direccion: { contains: texto } },
            { user: { email: { contains: texto } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.client.findMany({
      where,
      include: INCLUDE,
      orderBy: { nombre: 'asc' },
      take: tomar,
      skip: saltar,
    }),
    prisma.client.count({ where }),
  ]);

  return { items: items.map(fichaView), total };
}

export async function getById(businessId, id) {
  const cliente = await prisma.client.findFirst({ where: { id, businessId }, include: INCLUDE });

  if (!cliente) {
    throw ApiError.notFound('Cliente no encontrado');
  }

  return cliente;
}

/** Ficha completa para el modal de detalle. */
export async function detail(businessId, id) {
  return fichaView(await getById(businessId, id));
}

/** El CLIENT solo existe a traves de su propia ficha. */
export async function getSelf(user) {
  if (!user.clientId) {
    throw ApiError.notFound('Esta cuenta no tiene ficha de cliente');
  }

  const cliente = await prisma.client.findUnique({ where: { id: user.clientId }, include: INCLUDE });

  if (!cliente) {
    throw ApiError.notFound('Cliente no encontrado');
  }

  return fichaView(cliente);
}

/**
 * Alta de cliente: la cuenta de usuario y su ficha nacen juntas, porque una
 * ficha sin cuenta no puede entrar al panel ni cambiarse la contrasena.
 */
export async function create(businessId, data) {
  const email = data.email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw ApiError.conflict('Ese email ya esta registrado');
  }

  const esTemporal = !data.password;
  const clave = data.password || generarPasswordTemporal();

  const cliente = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { nombre: data.nombre, email, passwordHash: await hashPassword(clave), role: 'CLIENT', businessId },
      select: { id: true },
    });

    return tx.client.create({
      data: {
        userId: user.id,
        businessId,
        nombre: data.nombre,
        documento: data.documento,
        fechaNacimiento: parseDateOnly(data.fechaNacimiento),
        telefono: data.telefono,
        direccion: data.direccion,
      },
      include: INCLUDE,
    });
  });

  return {
    cliente: fichaView(cliente),
    ...(esTemporal ? { passwordTemporal: clave } : {}),
  };
}

/**
 * Lo que la administracion puede cambiar de una ficha. Nombre, email, estado y
 * contrasena viven en la cuenta de usuario, asi que se actualizan ahi; el resto
 * va en la ficha. Se tocan los dos sitios o la lista de clientes y la cuenta
 * dejarian de cuadrar.
 */
export async function update(businessId, id, data) {
  const cliente = await getById(businessId, id);
  const { nombre, email, documento, fechaNacimiento, telefono, direccion, password, activo } = data;

  const actualizado = await prisma.$transaction(async (tx) => {
    const cuenta = {};
    if (nombre !== undefined) cuenta.nombre = nombre;
    if (email !== undefined) cuenta.email = email.toLowerCase();
    if (activo !== undefined) cuenta.activo = activo;
    if (password) cuenta.passwordHash = await hashPassword(password);

    if (Object.keys(cuenta).length > 0) {
      await tx.user.update({ where: { id: cliente.user.id }, data: cuenta });
    }

    return tx.client.update({
      where: { id },
      data: {
        ...(nombre !== undefined ? { nombre } : {}),
        ...(documento !== undefined ? { documento } : {}),
        ...(fechaNacimiento !== undefined
          ? { fechaNacimiento: fechaNacimiento ? parseDateOnly(fechaNacimiento) : null }
          : {}),
        ...(telefono !== undefined ? { telefono } : {}),
        ...(direccion !== undefined ? { direccion } : {}),
      },
      include: INCLUDE,
    });
  });

  return fichaView(actualizado);
}

/**
 * El cliente edita su propia ficha desde el perfil. No puede tocar el rol ni el
 * estado de su cuenta: la reactivacion la decide la administracion, y la
 * contrasena se cambia por su propia via (/auth/password).
 */
export async function updateSelf(user, data) {
  const propia = await getSelf(user);

  return update(propia.businessId, propia.id, data);
}

/**
 * Baja de cliente. Se lleva por delante su cuenta y sus citas, asi que sus
 * horarios vuelven a quedar libres y las tareas que solo existian para esas
 * citas se van con ellas: si no, aparecian en la lista de trabajo como tareas
 * sueltas que nadie habia creado.
 *
 * Los horarios se liberan DESPUES de borrar: hasta que las citas no desaparecen
 * el hueco sigue ocupado de verdad.
 */
export async function remove(businessId, id) {
  await getById(businessId, id);

  return prisma.$transaction(async (tx) => {
    const citas = await tx.appointment.findMany({
      where: { clientId: id },
      select: { availabilityId: true, taskId: true, status: true },
    });

    await tx.client.delete({ where: { id } });

    await liberarHuecos(tx, citas);

    await borrarTareasHuerfanas(tx, citas.map((cita) => cita.taskId));
  });
}

/** Una tarea que se creo para una cita y ya no tiene ninguna no aporta nada. */
async function borrarTareasHuerfanas(tx, taskIds) {
  const ids = [...new Set(taskIds)].filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  const huerfanas = await tx.task.findMany({
    where: { id: { in: ids }, appointments: { none: {} } },
    select: { id: true },
  });

  if (huerfanas.length > 0) {
    await tx.task.deleteMany({ where: { id: { in: huerfanas.map((tarea) => tarea.id) } } });
  }
}