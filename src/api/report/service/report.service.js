import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { parseDateOnly, hoyEn } from '../../../utils/dates.js';

/**
 * Informes (nuevo en v2).
 *
 * v1 no tenia ninguno. Eso es grave en un sistema de citas: la pregunta "cuanto
 * lleno estoy" y "que servicio se vende mas" son las dos que un negocio se hace
 * cada semana, y obligan a exportar a una hoja de calculo y contar a mano.
 *
 * Todos los informes son de LECTURA: no filtran por `businessId` del cliente ni
 * aceptan nada que no sea un rango de fechas acotado. Un informe que cuelga de un
 * `groupBy` sobre toda la tabla es una forma elegante de volcar la base entera.
 */

function rango(req) {
  const timezone = req.business?.timezone ?? 'UTC';
  const hasta = req.query.hasta || hoyEn(timezone);
  const desde = req.query.desde || `${Number(hasta.slice(0, 4)) - 1}-${hasta.slice(5)}`;

  /// Un rango de diez años sobre una tabla de millones de filas no es un
  /// informe, es un denial of service que alguien pide con dos parametros.
  if (desde > hasta)
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'desde', message: 'La fecha inicial es posterior a la final' },
    ]);

  const dias = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000;

  if (dias > 731) {
    throw ApiError.badRequest('El rango no puede pasar de 2 anos');
  }

  return { desde: parseDateOnly(desde), hasta: parseDateOnly(hasta), desdeIso: desde, hastaIso: hasta };
}

/** Filtro comun: citas de un negocio dentro de un rango, por fecha de HORARIO. */
function filtroCitas(businessId, { desde, hasta }) {
  return {
    businessId,
    deletedAt: null,
    availability: { is: { date: { gte: desde, lte: hasta } } },
  };
}

/** Cifras de cabecera para las tarjetas del panel. */
export async function overview(businessId, req) {
  const { desde, hasta, desdeIso, hastaIso } = rango(req);
  const citas = filtroCitas(businessId, { desde, hasta });

  /*
   * Aqui no hay `aggregate({ _sum: { _count: true } })` como en la v1.
   *
   * Sumar `_count` no es una operacion valida: Prisma lo rechaza con un
   * ValidationError y el informe entero devolvia 500. Y no hacia falta: "cuantas
   * citas completadas hay" ya sale del `groupBy` por estado de la primera promesa.
   * Una consulta menos y el informe funciona.
   */
  const [porEstado, huecos, ausencias, clientes] = await Promise.all([
    prisma.appointment.groupBy({ by: ['status'], where: citas, _count: { _all: true } }),
    prisma.availability.count({ where: { businessId, deletedAt: null, date: { gte: desde, lte: hasta } } }),
    prisma.appointment.count({ where: { ...citas, status: 'NO_SHOW' } }),
    prisma.client.count({ where: { businessId, deletedAt: null, appointments: { some: { ...citas } } } }),
  ]);

  const cuenta = Object.fromEntries(porEstado.map((f) => [f.status, f._count._all]));

  const cerradas =
    (cuenta.COMPLETED ?? 0) + (cuenta.CANCELLED ?? 0) + (cuenta.REJECTED ?? 0) + (cuenta.NO_SHOW ?? 0);
  const realizadas = cuenta.COMPLETED ?? 0;
  const vivas = (cuenta.PENDING ?? 0) + (cuenta.COORDINATED ?? 0);

  return {
    rango: { desde: desdeIso, hasta: hastaIso },
    citas: {
      total: cerradas + vivas,
      pendientes: cuenta.PENDING ?? 0,
      coordinadas: cuenta.COORDINATED ?? 0,
      completadas: realizadas,
      canceladas: cuenta.CANCELLED ?? 0,
      rechazadas: cuenta.REJECTED ?? 0,
      ausencias,
    },
    ocupacion: {
      huecosPublicados: huecos,
      /// Porcentaje de huecos que acabaron ocupados por una cita viva o ya
      /// realizada. Los cancelados cuentan como hueco libre: el bloque se libero.
      porcentajeOcupado: huecos > 0 ? Math.round(((realizadas + vivas) / huecos) * 100) : 0,
      /// De las citas ya cerradas, cuantas se realizaron. Es el numero que de
      /// verdad dice si la agenda funciona.
      tasaRealizacion: cerradas > 0 ? Math.round((realizadas / cerradas) * 100) : 0,
      /// Ausencias sobre el total cerrado. Alto aqui es una senal de que el
      /// recordatorio no llega o de que la confirmacion no se pide.
      tasaAusencia: cerradas > 0 ? Math.round((ausencias / cerradas) * 100) : 0,
    },
    clientes: { activos: clientes },
  };
}

/** Ocupacion por dia. Es lo que alimenta el grafico del calendario. */
export async function occupancy(businessId, req) {
  const { desde, hasta, desdeIso, hastaIso } = rango(req);

  const [citas, huecos] = await Promise.all([
    prisma.appointment.findMany({
      where: filtroCitas(businessId, { desde, hasta }),
      select: {
        status: true,
        availability: { select: { date: true } },
      },
    }),
    prisma.availability.findMany({
      where: { businessId, deletedAt: null, date: { gte: desde, lte: hasta } },
      select: { date: true, status: true },
    }),
  ]);

  const porDia = new Map();

  const asegurar = (fecha) => {
    const clave = fecha.toISOString().slice(0, 10);

    if (!porDia.has(clave)) {
      porDia.set(clave, { fecha: clave, huecos: 0, ocupados: 0, realizadas: 0, canceladas: 0, ausencias: 0 });
    }

    return porDia.get(clave);
  };

  for (const hueco of huecos) {
    asegurar(hueco.date).huecos += 1;
  }

  for (const cita of citas) {
    if (!cita.availability) continue;

    const fila = asegurar(cita.availability.date);

    if (['PENDING', 'COORDINATED', 'COMPLETED'].includes(cita.status)) fila.ocupados += 1;
    if (cita.status === 'COMPLETED') fila.realizadas += 1;
    if (['CANCELLED', 'REJECTED'].includes(cita.status)) fila.canceladas += 1;
    if (cita.status === 'NO_SHOW') fila.ausencias += 1;
  }

  const items = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

  for (const fila of items) {
    fila.porcentaje = fila.huecos > 0 ? Math.round((fila.ocupados / fila.huecos) * 100) : 0;
  }

  return { rango: { desde: desdeIso, hasta: hastaIso }, items };
}

/** Que servicios se piden mas. */
export async function services(businessId, req) {
  const { desde, hasta, desdeIso, hastaIso } = rango(req);

  const grouped = await prisma.appointment.groupBy({
    by: ['taskId'],
    where: filtroCitas(businessId, { desde, hasta }),
    _count: { _all: true },
  });

  if (grouped.length === 0) return { rango: { desde: desdeIso, hasta: hastaIso }, items: [] };

  const tareas = await prisma.task.findMany({
    where: { id: { in: grouped.map((g) => g.taskId) } },
    select: {
      id: true,
      title: true,
      category: { select: { id: true, name: true, color: true, precio: true } },
    },
  });

  const porTarea = new Map(tareas.map((t) => [t.id, t]));
  const conteo = new Map(grouped.map((g) => [g.taskId, g._count._all]));

  const items = [...conteo.entries()]
    .map(([taskId, total]) => {
      const tarea = porTarea.get(taskId);
      if (!tarea) return null;

      return {
        /// `tareaId: taskId` y no `tareaId,`.
        ///
        /// El atajo de objeto `tareaId,` significa `tareaId: tareaId`, y no existe
        /// ninguna variable con ese nombre: la del `map` es `taskId`. El valor
        /// salia `undefined`, que `JSON.stringify` se come sin avisar, asi que el
        /// informe de servicios mas vendidos llegaba sin el id de la tarea y sin
        /// ningun error por medio.
        tareaId: taskId,
        titulo: tarea.title,
        categoria: tarea.category?.name ?? null,
        color: tarea.category?.color ?? null,
        precio:
          tarea.category?.precio !== null && tarea.category?.precio !== undefined
            ? Number(tarea.category.precio)
            : null,
        citas: total,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.citas - a.citas);

  const total = items.reduce((suma, item) => suma + item.citas, 0);

  for (const item of items) {
    item.porcentaje = total > 0 ? Math.round((item.citas / total) * 100) : 0;
    item.ingresoEstimado = item.precio !== null ? Math.round(item.precio * item.citas * 100) / 100 : null;
  }

  return { rango: { desde: desdeIso, hasta: hastaIso }, items, totalCitas: total };
}

/** Por que se cancelan las citas. El campo `cancelReason` existe justo para esto. */
export async function cancellations(businessId, req) {
  const { desde, hasta, desdeIso, hastaIso } = rango(req);

  const grouped = await prisma.appointment.groupBy({
    by: ['cancelReason'],
    where: {
      ...filtroCitas(businessId, { desde, hasta }),
      status: { in: ['CANCELLED', 'REJECTED'] },
    },
    _count: { _all: true },
  });

  const items = grouped
    .filter((f) => f.cancelReason)
    .map((f) => ({ motivo: f.cancelReason, citas: f._count._all }))
    .sort((a, b) => b.citas - a.citas);

  const total = items.reduce((suma, item) => suma + item.citas, 0);

  for (const item of items) {
    item.porcentaje = total > 0 ? Math.round((item.citas / total) * 100) : 0;
  }

  return { rango: { desde: desdeIso, hasta: hastaIso }, items, total };
}

/**
 * Ausencias por profesional (nuevo en v2).
 *
 * NO_SHOW es un estado en v2 precisamente para que esto se pueda medir. En v1 todo
 * se guardaba como CANCELLED y este informe era imposible: no habia forma de
 * distinguir de "no vino" de "cancelo con tiempo".
 */
export async function noShow(businessId, req) {
  const { desde, hasta, desdeIso, hastaIso } = rango(req);

  const [porProfesional, totalCerradas] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['staffId'],
      where: { ...filtroCitas(businessId, { desde, hasta }), status: 'NO_SHOW' },
      _count: { _all: true },
    }),
    prisma.appointment.count({
      where: {
        ...filtroCitas(businessId, { desde, hasta }),
        status: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'REJECTED'] },
      },
    }),
  ]);

  const ids = porProfesional.map((p) => p.staffId).filter(Boolean);
  const profesionales =
    ids.length > 0
      ? await prisma.staff.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } })
      : [];

  const nombres = new Map(profesionales.map((p) => [p.id, p.nombre]));

  const items = porProfesional
    .map((p) => ({
      staffId: p.staffId,
      nombre: p.staffId ? (nombres.get(p.staffId) ?? 'Desconocido') : 'Sin profesional asignado',
      ausencias: p._count._all,
    }))
    .sort((a, b) => b.ausencias - a.ausencias);

  return {
    rango: { desde: desdeIso, hasta: hastaIso },
    items,
    totalAusencias: items.reduce((suma, item) => suma + item.ausencias, 0),
    totalCerradas,
    porcentaje:
      totalCerradas > 0 ? Math.round((items.reduce((s, i) => s + i.ausencias, 0) / totalCerradas) * 100) : 0,
  };
}

/**
 * Exportacion a CSV (nuevo en v2).
 *
 * Sin esto, "pasame las citas de marzo" acababa en un copiar-pegar de la pantalla
 * del panel, que sale truncado a los 50.
 *
 * El CSV se arma a mano y TODOS los valores se escapan. Un nombre con coma
 * ("Garcia, Juan") partia la fila en dos; un nombre con `=` o `+` al principio
 * ejecutaba formula en Excel y en Hojas de Calculo. El prefijo `'` en esos casos
 * no es cosmetico, es la unica cosa que evita que un cliente vea un formulario
 * de pago al abrir el archivo.
 */
function celda(valor) {
  if (valor === null || valor === undefined) return '';

  const texto = String(valor);

  /// Si el valor empieza por un caracter de formula, Excel lo interpreta como
  /// una. Con el apostrofo delante se muestra literal.
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;

  if (typeof valor === 'string' && /[",;\n\r]/.test(seguro)) {
    return `"${seguro.replace(/"/g, '""')}"`;
  }

  return seguro;
}

const CSV = { escribir: (filas) => filas.map((fila) => fila.map(celda).join(';')).join('\r\n') };

export async function exportCsv(businessId, req) {
  const { desde, hasta, desdeIso, hastaIso } = rango(req);

  const citas = await prisma.appointment.findMany({
    where: filtroCitas(businessId, { desde, hasta }),
    include: {
      client: { select: { nombre: true, documento: true, user: { select: { email: true } } } },
      availability: { select: { date: true, startTime: true, endTime: true } },
      task: { select: { title: true, category: { select: { name: true } } } },
      staff: { select: { nombre: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 10_000,
  });

  const filas = [
    [
      'ID',
      'Fecha',
      'Hora inicio',
      'Hora fin',
      'Estado',
      'Servicio',
      'Categoria',
      'Profesional',
      'Cliente',
      'Documento',
      'Email',
      'Motivo',
      'Registada',
    ],
    ...citas.map((cita) => [
      cita.id,
      cita.availability ? cita.availability.date.toISOString().slice(0, 10) : '',
      cita.availability?.startTime ?? '',
      cita.availability?.endTime ?? '',
      cita.status,
      cita.task?.title ?? '',
      cita.task?.category?.name ?? '',
      cita.staff?.nombre ?? '',
      cita.client?.nombre ?? '',
      cita.client?.documento ?? '',
      cita.client?.user?.email ?? '',
      cita.cancelReason ?? '',
      cita.createdAt.toISOString().slice(0, 19).replace('T', ' '),
    ]),
  ];

  return {
    nombre: `citas_${desdeIso}_${hastaIso}.csv`,
    contenido: CSV.escribir(filas),
    total: citas.length,
  };
}

export default { overview, occupancy, services, cancellations, noShow, exportCsv };
