import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { formatDateOnly, parseDateOnly, hoyEn } from '../../../utils/dates.js';
import { pagination, busquedaTexto } from '../../../utils/pagination.js';
import { auditar } from '../../../utils/audit.js';
import { liberarHuecos } from '../../appointment/service/appointment.service.js';

const INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  client: { select: { id: true, nombre: true } },
  _count: { select: { appointments: true } },
};

/** Estados en los que una tarea sigue abierta. */
const ABIERTAS = ['PENDING', 'IN_PROGRESS'];

/**
 * "Sin fecha" es como la llama el frontend a una tarea sin dueDate: no es un
 * estado, es la ausencia de fecha, asi que se calcula al pintar en vez de guardarlo
 * en un campo mas.
 *
 * Lo mismo con `vencida`: una tarea con fecha anterior a hoy que sigue abierta.
 * v2 lo expone porque "que se me paso" era la pregunta mas frecuente al abrir el
 * panel, y obligaba a mirar cada fila.
 */
function tareaView({ dueDate, _count, ...tarea }, timezone = 'UTC') {
  const hoy = hoyEn(timezone);

  return {
    ...tarea,
    dueDate: formatDateOnly(dueDate),
    sinFecha: dueDate === null,
    vencida: dueDate !== null && formatDateOnly(dueDate) < hoy && ABIERTAS.includes(tarea.status),
    citas: _count.appointments,
  };
}

/** Un CLIENT solo ve las tareas asignadas a el. */
function alcanceDeUsuario(user) {
  return user.role === 'CLIENT' ? { clientId: user.clientId } : {};
}

function whereDe(user, businessId, filters = {}, timezone = 'UTC') {
  return {
    businessId,
    deletedAt: null,
    ...alcanceDeUsuario(user),
    ...(filters.estado ? { status: filters.estado } : {}),
    ...(filters.filtro === 'pendientes' ? { status: { in: ABIERTAS } } : {}),
    ...(filters.filtro === 'completadas' ? { status: 'COMPLETED' } : {}),
    ...(filters.filtro === 'sin-fecha' ? { dueDate: null } : {}),
    ...(filters.filtro === 'agendadas' ? { dueDate: { not: null } } : {}),
    /// "Vencidas" se calcula con la zona del negocio: una tarea que vence hoy a
    /// las 18:00 no esta vencida a las 15:00 aunque el servidor ya sea otro dia.
    ...(filters.filtro === 'vencidas'
      ? { status: { in: ABIERTAS }, dueDate: { not: null, lt: parseDateOnly(hoyEn(timezone)) } }
      : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    /// Las tareas que nacen de una cita se gestionan en la pagina de citas, asi
    /// que la vista de trabajo las aparta.
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

export async function list(user, businessId, filters = {}, timezone = 'UTC') {
  const { limit: tomar, offset: saltar } = pagination(filters);
  const where = whereDe(user, businessId, filters, timezone);

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

  return { items: items.map((t) => tareaView(t, timezone)), total };
}

export async function getById(user, businessId, id) {
  const tarea = await prisma.task.findFirst({
    where: { id, businessId, deletedAt: null },
    include: INCLUDE,
  });

  if (!tarea) throw ApiError.notFound('Tarea no encontrada');

  /// Un cliente que pide una cita ajena recibe 404 y no 403: confirmar que
  /// existe seria filtrar informacion de la cartera.
  if (user.role === 'CLIENT' && tarea.clientId !== user.clientId) {
    throw ApiError.notFound('Tarea no encontrada');
  }

  return tarea;
}

export async function detail(user, businessId, id, timezone = 'UTC') {
  return tareaView(await getById(user, businessId, id), timezone);
}

/**
 * Alta de tarea. Cada cita genera ademas su propia tarea, asi que esta es para el
 * trabajo suelto: una compra, una revision, un aviso.
 */
export async function create(user, businessId, data, req) {
  const { dueDate, categoryId, clientId, ...resto } = data;

  if (categoryId) await assertCategoriaDelNegocio(businessId, categoryId);
  if (clientId) await assertClienteDelNegocio(businessId, clientId);

  /// Un CLIENT crea tareas solo para si mismo.
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

  auditar({ businessId, actorId: user.id, action: 'create', entity: 'Task', entityId: tarea.id, req });

  return tareaView(tarea);
}

export async function update(user, businessId, id, data, req) {
  await getById(user, businessId, id);

  const { dueDate, categoryId, clientId, ...resto } = data;

  if (categoryId) await assertCategoriaDelNegocio(businessId, categoryId);
  if (clientId) await assertClienteDelNegocio(businessId, clientId);

  /// El cliente no puede reasignar su tarea a otra persona ni cambiar su estado.
  const editable = user.role === 'CLIENT' ? pick(resto, ['description']) : resto;

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
      /// La fecha si puede moverla el cliente: es su trabajo.
      ...(dueDate !== undefined ? { dueDate: dueDate ? parseDateOnly(dueDate) : null } : {}),
    },
    include: INCLUDE,
  });

  auditar({ businessId, actorId: user.id, action: 'update', entity: 'Task', entityId: id, req });

  return tareaView(tarea);
}

function pick(data, claves) {
  return Object.fromEntries(Object.entries(data).filter(([clave]) => claves.includes(clave)));
}

/**
 * Baja de tarea: LOGICA (soft delete).
 *
 * En v1 el DELETE se llevaba por delante las citas que colgaban de la tarea y no
 * habia vuelta atras. Ahora la tarea se marca `deletedAt` y sus citas vivas se
 * cancelan liberando el horario: el historial de la cita se conserva y el hueco
 * queda libre, que es lo que importa cuando se borra una cita por error.
 *
 * Con `?hard=true` se borra en cascada de verdad.
 */
export async function remove(user, businessId, id, req, { hard = false } = {}) {
  await getById(user, businessId, id);

  const citas = await prisma.appointment.findMany({
    where: { taskId: id, deletedAt: null },
    select: { id: true, availabilityId: true, status: true },
  });

  const vivas = citas.filter((cita) => ['PENDING', 'COORDINATED'].includes(cita.status));

  if (hard) {
    await prisma.$transaction(async (tx) => {
      await tx.task.delete({ where: { id } });
      await liberarHuecos(tx, citas);
    });

    auditar({ businessId, actorId: user.id, action: 'delete_hard', entity: 'Task', entityId: id, req });
    return;
  }

  await prisma.$transaction(async (tx) => {
    /// `updateMany` en vez de un bucle de `update`: una sola sentencia en lugar
    /// de una por cita. Con SQLite, que tiene un unico escritor, mantener el
    /// lock del pool abierto durante N idas y venidas hacia que todo el resto de
    /// la API reciba SQLITE_BUSY.
    await tx.appointment.updateMany({
      where: { id: { in: vivas.map((cita) => cita.id) } },
      data: { status: 'CANCELLED', cancelReason: 'Tarea eliminada' },
    });

    /// Los recordatorios de esas citas dejan de esperar: si no, el worker avisa
    /// de citas que acaban de cancelarse.
    await tx.reminder.updateMany({
      where: { appointmentId: { in: vivas.map((cita) => cita.id) }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    await tx.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await liberarHuecos(tx, vivas);
  });

  auditar({ businessId, actorId: user.id, action: 'delete', entity: 'Task', entityId: id, req });
}

async function assertCategoriaDelNegocio(businessId, categoryId) {
  const categoria = await prisma.category.findFirst({
    where: { id: categoryId, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!categoria) throw ApiError.badRequest('La categoria indicada no pertenece al negocio');
}

async function assertClienteDelNegocio(businessId, clientId) {
  const cliente = await prisma.client.findFirst({
    where: { id: clientId, businessId, deletedAt: null },
    select: { id: true },
  });

  if (!cliente) throw ApiError.badRequest('El cliente indicado no pertenece al negocio');
}

export default { list, detail, create, update, remove };
