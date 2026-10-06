import { prisma } from "../config/database.js";
import { noEncontrado } from "../utils/http.js";
import { aMedianocheUTC } from "../utils/date.js";

/**
 * Filtros de listado (§13):
 *   todas         -> por defecto
 *   agendadas     -> con fecha dentro del rango [desde, hasta]
 *   sin-fecha     -> dueDate IS NULL  (la vista "Tareas sin fecha")
 *   completadas   -> status = COMPLETED
 *   pendientes    -> PENDING o IN_PROGRESS
 *   mias          -> sólo las del cliente indicado
 *
 * Y el alcance, que se combina con cualquiera de los filtros anteriores:
 *   alcance=propias   -> las tareas sueltas, sin cita detrás
 *   alcance=de-citas  -> las que nacieron al registrar una cita
 *
 * Registrar una cita crea su tarea propia, y esa tarea ya se gestiona en "Citas"
 * y en el calendario. Por eso el alcance permite apartarlas de la lista de
 * trabajo del administrador, que queda así con lo suyo y poco más.
 */
function condicionesDeFiltro({ filtro, alcance, estado, desde, hasta, categoryId, clientId }) {
  const condiciones = [];
  if (alcance === "propias" || alcance === "de-citas") {
    condiciones.push({ appointments: alcance === "propias" ? { none: {} } : { some: {} } });
  }
  if (estado) {
    condiciones.push({ status: estado });
  }
  if (categoryId) {
    condiciones.push({ categoryId });
  }
  if (clientId) {
    condiciones.push({ clientId });
  }
  if (filtro === "sin-fecha") {
    condiciones.push({ dueDate: null });
  }
  if (filtro === "agendadas") {
    condiciones.push({ dueDate: { not: null } });
    if (desde || hasta) {
      condiciones.push({
        dueDate: {
          ...(desde ? { gte: aMedianocheUTC(desde) } : {}),
          ...(hasta ? { lte: aMedianocheUTC(hasta) } : {})
        }
      });
    }
  }
  if (filtro === "pendientes") {
    condiciones.push({ status: { in: ["PENDING", "IN_PROGRESS"] } });
  }
  if (filtro === "completadas") {
    condiciones.push({ status: "COMPLETED" });
  }
  if (desde && !filtro) {
    condiciones.push({ dueDate: { gte: aMedianocheUTC(desde) } });
  }
  if (hasta && !filtro) {
    condiciones.push({ dueDate: { lte: aMedianocheUTC(hasta) } });
  }
  return condiciones;
}

export async function listarTareas(filtros, businessId) {
  const condiciones = [{ businessId }, ...condicionesDeFiltro(filtros)];
  const where = condiciones.length > 0 ? { AND: condiciones } : undefined;

  const [total, tareas] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        client: { select: { id: true, nombre: true } },
        _count: { select: { appointments: true } }
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: filtros.limit,
      skip: filtros.offset
    })
  ]);

  return { total, items: tareas };
}

export async function obtenerTarea(id, businessId = null) {
  const tarea = await prisma.task.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      client: { select: { id: true, nombre: true, userId: true } },
      appointments: {
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" }
      }
    }
  });
  if (!tarea || (businessId !== null && tarea.businessId !== businessId)) {
    throw noEncontrado("La tarea no existe.");
  }
  return tarea;
}

export async function crearTarea(datos, businessId) {
  return prisma.task.create({
    data: {
      businessId,
      title: datos.title,
      description: datos.description,
      status: datos.status || "PENDING",
      // undefined = no tocar; null = guardar NULL (tarea sin categoría, sin
      // cliente o sin fecha, que es un caso válido).
      categoryId: datos.categoryId,
      clientId: datos.clientId,
      dueDate: datos.dueDate === undefined ? undefined : aMedianocheUTCOpcional(datos.dueDate),
      dueTime: datos.dueTime
    },
    include: { category: true, client: true }
  });
}

export async function actualizarTarea(id, cambios, businessId) {
  await obtenerTarea(id, businessId);
  return prisma.task.update({
    where: { id },
    data: {
      title: cambios.title,
      description: cambios.description,
      status: cambios.status,
      categoryId: cambios.categoryId,
      clientId: cambios.clientId,
      dueDate: cambios.dueDate === undefined ? undefined : aMedianocheUTCOpcional(cambios.dueDate),
      dueTime: cambios.dueTime
    },
    include: { category: true, client: true }
  });
}

export async function eliminarTarea(id, businessId) {
  await obtenerTarea(id, businessId);
  return prisma.task.delete({ where: { id } });
}

/** null -> null (tarea sin fecha); "AAAA-MM-DD" -> Date en medianoche UTC. */
function aMedianocheUTCOpcional(valor) {
  return valor ? aMedianocheUTC(valor) : null;
}
