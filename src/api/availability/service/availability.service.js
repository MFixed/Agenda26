import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { formatDateOnly, hoyEn, parseDateOnly } from '../../../utils/dates.js';
import { pagination } from '../../../utils/pagination.js';
import { auditar } from '../../../utils/audit.js';
import { omitir } from '../../../utils/validation.js';

const INCLUDE = {
  _count: { select: { appointments: true } },
  staff: { select: { id: true, nombre: true, color: true } },
};

/** Rangos que ocupan agenda: no se pueden pisar. */
const BLOQUEAN = ['AVAILABLE', 'HELD', 'RESERVED'];

/**
 * Estados de cita que siguen consumiendo su bloque.
 *
 * COMPLETED y NO_SHOW tambien retienen: una cita que se atendio o en la que el
 * cliente no apareció ya uso ese horario, y volverlo a poner a la venta es
 * revender la misma franja. Es la misma lista que usa el servicio de citas.
 */
const RETIENEN_HUECO = ['PENDING', 'COORDINATED', 'COMPLETED', 'NO_SHOW'];

/** "09:00" < "10:00" funciona como texto: los dos tienen el mismo formato. */
function solapa(startTime, endTime, inicio, fin) {
  return startTime < fin && endTime > inicio;
}

/**
 * El dia se devuelve como texto: es lo que espera <input type="date">.
 *
 * `deletedAt` y `_count` se quitan a proposito: no tienen nada que ver en una
 * respuesta y `deletedAt` en el JSON invitaba a preguntar si un hueco con
 * `deletedAt` estaba o no en el aire.
 */
function huecoView(huecoCompleto) {
  const hueco = omitir(huecoCompleto, 'deletedAt', '_count');

  return {
    ...hueco,
    date: formatDateOnly(huecoCompleto.date),
    citas: huecoCompleto._count?.appointments ?? 0,
    profesional: huecoCompleto.staff ?? null,
  };
}

export async function list(businessId, filters = {}, userId = null) {
  const { limit, offset } = pagination(filters);

  /*
   * Los dos filtros que usan OR (el de profesional y el de estado) van DENTRO de un
   * `AND`.
   *
   * En un objeto de Prisma no puede haber dos claves `OR` en el mismo nivel: la
   * segunda machacaria a la primera y el filtro de profesional desapareceria sin
   * avisar. El sintoma era "filtrar por Sofia devuelve tambien los huecos de Martin".
   *
   * Con AND, cada bloque se evalua por separado y se cruzan: un hueco tiene que ser
   * del profesional pedido Y (o estar libre, o ser una retencion mia).
   */
  const where = {
    businessId,
    deletedAt: null,
    ...(filters.desde ? { date: { gte: parseDateOnly(filters.desde) } } : {}),
    ...(filters.hasta ? { date: { lte: parseDateOnly(filters.hasta) } } : {}),
    AND: [
      /// Sin `staffId` salen todos los huecos. Con `staffId` salen los suyos y los
      /// de "toda la empresa" (staffId nulo), que esos se pueden reservar con
      /// cualquiera.
      ...(filters.staffId ? [{ OR: [{ staffId: filters.staffId }, { staffId: null }] }] : []),

      /*
       * Cuando se pide estado AVAILABLE, tambien entran las PROPIAS retenciones.
       *
       * Sin esto, el cliente que acaba de retener un hueco lo pierde de la lista en el
       * siguiente refresco y su eleccion desaparece de la pantalla sin que haya
       * pasado nada. La retencion es suya: que la vea.
       */
      ...(filters.estado === 'AVAILABLE' && userId
        ? [
            {
              OR: [
                { status: 'AVAILABLE' },
                { status: 'HELD', heldById: userId, heldUntil: { gt: new Date() } },
              ],
            },
          ]
        : []),
    ],
    /// El estado va FUERA del AND para no pisarlo: si el cliente pide AVAILABLE, el
    /// WHERE tiene que seguir siendo sobre AVAILABLE (mas sus retenciones), no sobre
    /// lo que el bloque anterior deje puesto.
    ...(filters.estado && filters.estado !== 'AVAILABLE' ? { status: filters.estado } : {}),
    ...(filters.estado === 'AVAILABLE' && !userId ? { status: 'AVAILABLE' } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.availability.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.availability.count({ where }),
  ]);

  return { items: items.map(huecoView), total };
}

/**
 * El cliente solo ve lo que puede reservar y solo hacia adelante: un hueco ya
 * pasado no sirve para nada y uno reservado no debe lacear a otros.
 *
 * El "hoy" se calcula en la zona del NEGOCIO, no en la del servidor: en v1 una
 * clinica de Montevideo veia el dia siguiente a partir de las 21:00 porque el
 * servidor estaba en UTC.
 */
export function filtersForClient(query, timezone = 'UTC') {
  /*
   * `limit` y `offset` tambien se devuelven.
   *
   * Antes se perdian aqui, mientras que la rama de admin si losPASABA: un cliente
   * quedaba clavado en 50 huecos sin poder pedir la pagina 2. En un calendario de
   * varias semanas eso significaba no ver mas alla del tercer dia, sin ninguna
   * explicacion y sin ningun error.
   */
  return {
    estado: 'AVAILABLE',
    desde: query.desde || hoyEn(timezone),
    hasta: query.hasta,
    staffId: query.staffId ? Number(query.staffId) : null,
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}),
    ...(query.offset !== undefined ? { offset: Number(query.offset) } : {}),
  };
}

export async function getById(businessId, id) {
  const hueco = await prisma.availability.findFirst({
    where: { id, businessId, deletedAt: null },
    include: INCLUDE,
  });

  if (!hueco) throw ApiError.notFound('Horario no encontrado');

  return hueco;
}

export async function detail(businessId, id) {
  return huecoView(await getById(businessId, id));
}

export async function create(businessId, data) {
  const date = parseDateOnly(data.date);

  await assertNoOverlap(businessId, date, data.startTime, data.endTime, null, data.staffId ?? null);

  const hueco = await prisma.availability.create({
    data: { ...data, businessId, date },
    include: INCLUDE,
  });

  return huecoView(hueco);
}

export async function update(businessId, id, data) {
  const hueco = await getById(businessId, id);

  const date = data.date === undefined ? hueco.date : parseDateOnly(data.date);
  const startTime = data.startTime ?? hueco.startTime;
  const endTime = data.endTime ?? hueco.endTime;
  const staffId = data.staffId === undefined ? hueco.staffId : data.staffId;

  if (startTime >= endTime) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'startTime', message: 'La hora de inicio debe ser anterior a la de fin' },
    ]);
  }

  /**
   * Un horario reservado con citas vivas no se libera a mano: el servicio de citas
   * es el unico que devuelve el hueco a AVAILABLE. Si no, se podrian crear citas
   * sobre un hueco que el calendario da por libre.
   *
   * Se cuentan las citas que RETIENEN el bloque, no solo las que lo ocupan: el
   * mismo servicio de citas considera que una cita completada o una ausencia
   * siguen consumiendo su horario. Contando solo PENDING y
   * COORDINATED, un bloque de las 09:00 se podia volver a poner a la venta
   * despues de atender al cliente de las 09:00.
   */
  if (hueco.status === 'RESERVED' && data.status === 'AVAILABLE') {
    const activas = await prisma.appointment.count({
      where: { availabilityId: id, status: { in: RETIENEN_HUECO }, deletedAt: null },
    });

    if (activas > 0) {
      throw ApiError.conflict('No puedes liberar un horario con citas activas');
    }
  }

  /// Un hueco retenido (HELD) que se edita a mano pierde la retencion: si el
  /// cliente sigue con el formulario abierto, su reserva ya no valdria.
  const liberandoHold = data.status && data.status !== 'HELD' && hueco.status === 'HELD';

  /**
   * El solape se comprueba SIEMPRE, venga el estado que venga.
   *
   * Antes se saltava cuando el hueco era `BLOCKED` (en cualquiera de los dos
   * lados), y eso abria un camino de dos pasos para la doble reserva: se creaba
   * un bloque `BLOCKED` solapado con otro sin comprobacion y luego se ponia a
   * `AVAILABLE`, que volvia a saltarse el chequeo porque el hueco "era" BLOCKED.
   * Los dos acababan vendibles y solapados.
   *
   * `BLOCKED` significa "no se puede reservar a mano", no "no colisiona": sigue
   * siendo un elemento de la agenda y no puede montarse encima de otro sin
   * querer. Lo que si se permite es solapar un BLOCKED con otro BLOCKED, que es
   * la forma de tapar un tramo sin abrirlo y no deja ninguno de los dos en venta.
   */
  const ambosBloqueados = data.status === 'BLOCKED' && hueco.status === 'BLOCKED';

  if (!ambosBloqueados) {
    await assertNoOverlap(businessId, date, startTime, endTime, id, staffId ?? null);
  }

  const actualizado = await prisma.availability.update({
    where: { id },
    data: { ...data, date, ...(liberandoHold ? { heldUntil: null, heldById: null } : {}) },
    include: INCLUDE,
  });

  return huecoView(actualizado);
}

/**
 * Borrar un horario con citas encima dejaria citas apuntando a un hueco que ya no
 * existe, asi que se rechaza en vez de dejarlo al cascada.
 */
export async function remove(businessId, id, req, { hard = false } = {}) {
  const hueco = await getById(businessId, id);

  if (hueco._count.appointments > 0) {
    throw ApiError.conflict('No puedes eliminar un horario que tiene citas');
  }

  if (hard) {
    await prisma.availability.delete({ where: { id } });
  } else {
    await prisma.availability.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  auditar({ businessId, actorId: req.user?.id, action: 'delete', entity: 'Availability', entityId: id, req });
}

/**
 * Retiene un hueco mientras el cliente completa la reserva (nuevo en v2).
 *
 * El problema que resuelve: el cliente abre el formulario de cita, busca un hueco,
 * tarda dos minutos en escribir su nota, y mientras tanto otra persona lo
 * reserva. Cuando vuelve a confirmar, le sale un 409 y ha perdido el trabajo.
 *
 * Con `HELD` + `heldUntil`, el hueco queda apartado mientras dura el formulario y
 * el worker lo devuelve a AVAILABLE solo si nadie lo confirmo. La ventana sale de
 * `business.settings.holdMinutes`.
 *
 * La retencion NO es una reserva: no hay cita, no bloquea a las metricas y no
 * cuenta como ocupacion. Por eso no tiene indice unico y por eso expira sola.
 */
export async function hold(businessId, id, userId, minutos) {
  const hueco = await getById(businessId, id);

  /*
   * Tope de retenciones vivas por usuario.
   *
   * Retener es gratis, ilimitado y dura hasta `holdMinutes` (el tope del negocio es
   * de 120). Un unico cliente autenticado que llamara a este endpoint en bucle se
   * llevaba la agenda entera de la empresa dos horas, sin citas, sin rastro y sin
   * que nadie mas pudiera reservar nada.
   *
   * Se cuentan las retenciones VIVAS: las caducadas las devuelve el worker en
   * cualquier momento y no estorban nada. El limite es generoso (6) porque el uso
   * legitimo es uno o dos huecos mientras se rellenan formularios distintos.
   */
  const MAX_RETENCIONES = 6;
  const yaRetenidos = await prisma.availability.count({
    where: { businessId, heldById: userId, status: 'HELD', heldUntil: { gt: new Date() }, deletedAt: null },
  });

  const yaEsMio = hueco.heldById === userId && hueco.status === 'HELD';

  if (!yaEsMio && yaRetenidos >= MAX_RETENCIONES) {
    throw ApiError.conflict(
      'Ya tienes demasiados horarios reservados. Confirma o libera uno antes de seguir.'
    );
  }

  /*
   * La retencion se escribe de forma CONDICIONAL, con el estado en el filtro.
   *
   * Antes era leer y luego escribir por `id`: dos peticiones concurrentes leian
   * las dos AVAILABLE, pasaban las dos el chequeo y las dos escribian HELD. El
   * segundo que escribia se quedaba con el hueco, y el primero creia que lo
   * tenia reservado sin que su retencion constara por ninguna parte.
   *
   * `updateMany` con `status: 'AVAILABLE'` en el `where` hace el comprobar-y-poner
   * en una sola sentencia: el segundo recibe `count === 0` y sabe que lo perdió.
   */
  const hasta = new Date(Date.now() + minutos * 60_000);

  const { count } = await prisma.availability.updateMany({
    where: { id, businessId, status: 'AVAILABLE', deletedAt: null },
    data: { status: 'HELD', heldUntil: hasta, heldById: userId },
  });

  if (count === 0) {
    /// Si el hueco ya era suyo y sigue vivo, se le devuelve su propia retencion:
    /// refrescar el formulario no puede fallarle.
    if (yaEsMio && hueco.heldUntil && hueco.heldUntil > new Date()) {
      return { ...huecoView(hueco), retenidoHasta: hueco.heldUntil.toISOString() };
    }

    /// Y si no, otra persona lo ha cogido. El mensaje es el mismo que si estuviera
    /// reservado: no se revela que hay alguien mas ahi.
    throw ApiError.conflict('Ese horario ya no esta disponible');
  }

  const actualizado = await prisma.availability.findUnique({ where: { id }, include: INCLUDE });

  return { ...huecoView(actualizado), retenidoHasta: hasta.toISOString() };
}

/** Suelta una retencion propia. Solo la puede soltar quien la tiene. */
export async function releaseHold(businessId, id, userId) {
  const hueco = await getById(businessId, id);

  if (hueco.status !== 'HELD') return huecoView(hueco);

  if (hueco.heldById && hueco.heldById !== userId) {
    throw ApiError.forbidden('Ese horario no lo tienes retenido tu');
  }

  const actualizado = await prisma.availability.update({
    where: { id },
    data: { status: 'AVAILABLE', heldUntil: null, heldById: null },
    include: INCLUDE,
  });

  return huecoView(actualizado);
}

/**
 * Devuelve a AVAILABLE las retenciones caducadas.
 *
 * La corre el worker. Es idempotente: si no hay ninguna, no hace nada.
 */
export async function expirarHolds() {
  const { count } = await prisma.availability.updateMany({
    /// `deletedAt: null` importa: sin el, el worker resucitaba bloques borrados
    /// en cascada y los ponia a la venta. Hoy no lo lee nadie, pero es un
    /// resurrection que solo espera a que alguien olvide un filtro.
    where: { status: 'HELD', heldUntil: { lt: new Date() }, deletedAt: null },
    data: { status: 'AVAILABLE', heldUntil: null, heldById: null },
  });

  return count;
}

/**
 * Dos intervalos se solapan si el inicio de uno es anterior al fin del otro. Se
 * traen los rangos bloqueantes de ese dia y se comparan en memoria: son unos pocos,
 * y no hace falta disjuntar el filtro por cada combinacion de horas.
 *
 * Ojo al detalle: se excluyen los huecos del MISMO profesional. Dos profesionales
 * pueden atender a la vez al mismo cliente en salas distintas, y bloquearlos entre
 * si seria incorrecto. Los huecos sin profesional (los de "la empresa entera") si
 * bloquean a todos, que es lo que significa un bloque general.
 *
 * `staffId` TIENE que llegar aqui. Antes el parametro existia pero los dos
 * llamantes no lo pasaban, asi que siempre valia `null`: el bloque condicional de
 * mas abajo nunca se aplicaba y TODOS los huecos se bloqueaban entre si. Una
 * clinica con dos profesionales no podia publicar agenda en paralelo, porque el
 * segundo siempre recibia un 409.
 */
async function assertNoOverlap(businessId, date, startTime, endTime, excludeId, staffId = null) {
  const existentes = await prisma.availability.findMany({
    where: {
      businessId,
      date,
      deletedAt: null,
      status: { in: BLOQUEAN },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(staffId ? { OR: [{ staffId: null }, { staffId }] } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });

  const choque = existentes.find((otro) => solapa(startTime, endTime, otro.startTime, otro.endTime));

  if (choque) {
    throw ApiError.conflict(
      `El horario se solapa con otro ya publicado (${choque.startTime} - ${choque.endTime})`
    );
  }
}

export default { list, detail, create, update, remove, hold, releaseHold, expirarHolds, filtersForClient };
