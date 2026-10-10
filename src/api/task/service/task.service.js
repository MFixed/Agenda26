import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';
import { formatDateOnly, parseDateOnly } from '../../../utils/dates.js';
import { busquedaTexto, pagination } from '../../../utils/pagination.js';
import { liberarHuecos } from '../../appointment/service/appointment.service.js';

const INCLUDE = {
  category: { select: { id: true, name: true } },
  client: { select: { id: true, nombre: true } },
  _count: { select: { appointments: true } },
};

/** Estados en los que una tarea sigue abierta. */
const ABIERTAS = ['PENDING', 'IN_PROGRESS'];

/**
 * "Sin fecha" es como la llama el frontend a una tarea sin dueDate: no es un
 * estado, es la ausencia de fecha, asi que se calcula al pintar en vez de
 * guardarlo en un campo mas.
 */
function tareaView({ dueDate, _count, ...tarea }) {
  return { ...tarea, dueDate: formatDateOnly(dueDate), sinFecha: dueDate === null, citas: _count.appointments };
}

/** Un CLIENT solo ve las tareas asignadas a el. */
function alcanceDeUsuario(user) {
  return user.role === 'CLIENT' ? { clientId: user.clientId } : {};
}

function whereDe(user, businessId, filters = {}) {
  return {
    businessId,
    ...alcanceDeUsuario(user),
    ...(filters.estado ? { status: filters.estado } : {}),
    ...(filters.filtro === 'pendientes' ? { status: { in: ABIERTAS } } : {}),
    ...(filters.filtro === 'completadas' ? { status: 'COMPLETED' } : {}),
    ...(filters.filtro === 'sin-fecha' ? { dueDate: null } : {}),
    ...(filters.filtro === 'agendadas' ? { dueDate: { not: null } } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    // Las tareas que nacen de una cita se gestionan en la pagina de citas, asi
    // que la vista de trabajo las aparta.
    ...(filters.alcance === 'propias' ? { appointments: { none: {} } } : {}),
    ...(filters.alcance === 'de-citas' ? { appointments: { some: {} } } : {}),
    ...busquedaTexto(filters.q, ['title']),
    ...(filters.desde || filters.hasta
      ? {
          dueDate: {
            ...(filters.desde ? { gte: parseDateOnly(filters.desde) } : {}),
            ...(filters.hasta ? { lte: parseDateOnly(filters.hasta) } : {}),
          },
        }
      : {}),
  };
}

export async function list(user, businessId, filters = {}) {
  const { limit: tomar, offset: saltar } = pagination(filters);
  const where = whereDe(user, businessId, filters);

  const [items, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: tomar,
      skip: saltar,
    }),
    prisma.task.count({ where }),
  ]);

  return { items: items.map(tareaView), total };
}

export async function getById(user, businessId, id) {
  const tarea = await prisma.task.findFirst({ where: { id, businessId }, include: INCLUDE });

  if (!tarea) {
    throw ApiError.notFound('Tarea no encontrada');
  }

  if (user.role === 'CLIENT' && tarea.clientId !== user.clientId) {
    throw ApiError.notFound('Tarea no encontrada');
  }

  return tarea;
}

export async function detail(user, businessId, id) {
  return tareaView(await getById(user, businessId, id));
}

/**
 * Alta de tarea. Cada cita genera ademas su propia tarea, asi que esta es para
 * el trabajo suelto: una compra, una revision, un aviso.
 */
export async function create(user, businessId, data) {
  const { dueDate, categoryId, clientId, ...resto } = data;

  if (categoryId) {
    await assertCategoriaDelNegocio(businessId, categoryId);
  }

  if (clientId) {
    await assertClienteDelNegocio(businessId, clientId);
  }

  // Un CLIENT crea tareas solo para si mismo.
  const tarea = await prisma.task.create({
    data: {
      ...resto,
      businessId,
      categoryId,
      clientId: user.role === 'CLIENT' ? user.clientId : clientId,
      ...(dueDate ? { dueDate: parseDateOnly(dueDate) } : {}),
    },
    include: INCLUDE,
  });

  return tareaView(tarea);
}

export async function update(user, businessId, id, data) {
  await getById(user, businessId, id);

  const { dueDate, categoryId, clientId, ...resto } = data;

  if (categoryId) {
    await assertCategoriaDelNegocio(businessId, categoryId);
  }

  if (clientId) {
    await assertClienteDelNegocio(businessId, clientId);
  }

  // El cliente no puede reasignar su tarea a otra persona ni cambiar su estado.
  const editable =
    user.role === 'CLIENT'
      ? pick(resto, ['description'])
      : resto;

  const tarea = await prisma.task.update({
    where: { id },
    data: {
      ...editable,
      ...(user.role !== 'CLIENT'
        ? {
            ...(categoryId !== undefined ? { categoryId } : {}),
            ...(clientId !== undefined ? { clientId } : {}),
          }
        : {}),
      // La fecha y la hora si puede moverlas el cliente: son suyas.
      ...(dueDate !== undefined ? { dueDate: dueDate ? parseDateOnly(dueDate) : null } : {}),
    },
    include: INCLUDE,
  });

  return tareaView(tarea);
}

function pick(data, claves) {
  return Object.fromEntries(Object.entries(data).filter(([clave]) => claves.includes(clave)));
}

/**
 * Baja de tarea. Se lleva por delante las citas que colgaban de ella, asi que
 * sus horarios vuelven a quedar libres.
 *
 * El orden importa: los horarios se liberan DESPUES de borrar, porque mientras
 * las citas sigan existiendo el hueco sigue ocupado de verdad. Liberarlos antes
 * no haria nada y el calendario mostraria huecos reservados por citas que ya no
 * existen.
 */
export async function remove(user, businessId, id) {
  await getById(user, businessId, id);

  return prisma.$transaction(async (tx) => {
    const citas = await tx.appointment.findMany({
      where: { taskId: id },
      select: { availabilityId: true, status: true },
    });

    await tx.task.delete({ where: { id } });

    await liberarHuecos(tx, citas);
  });
}

async function assertCategoriaDelNegocio(businessId, categoryId) {
  const categoria = await prisma.category.findFirst({ where: { id: categoryId, businessId }, select: { id: true } });

  if (!categoria) {
    throw ApiError.badRequest('La categoria indicada no pertenece al negocio');
  }
}

async function assertClienteDelNegocio(businessId, clientId) {
  const cliente = await prisma.client.findFirst({ where: { id: clientId, businessId }, select: { id: true } });

  if (!cliente) {
    throw ApiError.badRequest('El cliente indicado no pertenece al negocio');
  }
}