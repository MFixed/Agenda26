import { randomBytes } from 'node:crypto';
import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { hashPassword } from '../../../utils/password.js';
import { formatDateOnly, parseDateOnly } from '../../../utils/dates.js';
import { pagination, paginaPorCursor } from '../../../utils/pagination.js';
import { auditar } from '../../../utils/audit.js';
import { omitir } from '../../../utils/validation.js';
import { liberarHuecos } from '../../appointment/service/appointment.service.js';

const INCLUDE = {
  user: { select: { id: true, email: true, activo: true, ultimoAcceso: true } },
  /// Las notas y el consentimiento estan en el perfil, que es una ficha aparte.
  profile: { select: { notas: true, aceptaMarketing: true, consentimientoAt: true } },
  _count: { select: { appointments: true, tasks: true } },
};

/** Anios cumplidos a dia de hoy. El frontend lo pinta junto a la fecha. */
function edadDe(fechaNacimiento) {
  if (!fechaNacimiento) return null;

  const hoy = new Date();
  let edad = hoy.getFullYear() - fechaNacimiento.getFullYear();

  const yaCumpleEsteAnio =
    hoy.getMonth() > fechaNacimiento.getMonth() ||
    (hoy.getMonth() === fechaNacimiento.getMonth() && hoy.getDate() >= fechaNacimiento.getDate());

  if (!yaCumpleEsteAnio) edad -= 1;

  return edad >= 0 ? edad : null;
}

/**
 * La ficha tal como la pintan las pantallas. El email y el estado de la cuenta
 * salen del usuario, no del cliente: no se guardan dos veces.
 */
/**
 * `deletedAt`, `_count` y `profile` se quitan a proposito: no tienen nada que
 * ver en una respuesta. `user` tampoco se reenvia entero, solo los tres campos que
 * la pantalla necesita, para no filtrar de paso el hash y la version del token.
 */
function fichaView(cliente) {
  const ficha = omitir(cliente, 'deletedAt', '_count', 'profile', 'user');

  return {
    ...ficha,
    fechaNacimiento: formatDateOnly(cliente.fechaNacimiento),
    edad: edadDe(cliente.fechaNacimiento),
    email: cliente.user?.email ?? null,
    activo: cliente.user?.activo ?? false,
    ultimoAcceso: cliente.user?.ultimoAcceso ?? null,
    /// Se aplanan las notas aqui para que el frontend no tenga que saber que estan en
    /// otra tabla: la respuesta tiene la misma forma que en v1.
    notas: cliente.profile?.notas ?? null,
    aceptaMarketing: cliente.profile?.aceptaMarketing ?? false,
    citas: cliente._count?.appointments ?? 0,
    tareas: cliente._count?.tasks ?? 0,
  };
}

/**
 * Contrasena temporal para un alta sin clave.
 *
 * Se devuelve una sola vez, en la respuesta del alta: es lo unico que la
 * administracion puede entregar al cliente y despues ya no se puede leer. En v2
 * ademas se manda por correo si hay Resend configurado, porque una contrasena
 * temporal que hay que llevar en mano a un cliente es una contrasena que se
 * pierde por el camino.
 */
function generarPasswordTemporal() {
  return `Cli-${randomBytes(5).toString('hex')}`;
}

/**
 * Listado de clientes.
 *
 * `?cursor=` pagina por cursor (constante, estable frente a inserciones);
 * `?limit=&offset=` pagina por numero de pagina (que es lo que el frontend ya
 * pinta, porque necesita el total). Se ofrecen las dos porque hacen falta las
 * dos: el paginador necesita total, un listado largo necesita cursor.
 */
export async function list(businessId, { q, limit, offset, cursor } = {}) {
  const where = {
    businessId,
    /// Baja logica: los clientes desactivados siguen en la base (por su
    /// historial) pero fuera de los listados.
    deletedAt: null,
    ...(q
      ? {
          OR: [
            /*
             * Sin `mode: 'insensitive'`: eso es solo de PostgreSQL. En SQLite,
             * `contains` genera `LIKE '%q%'`, y el LIKE de SQLite ya es
             * insensible a las mayusculas para los caracteres ASCII. Los acentos
             * ("Muñoz" vs "muñoz") no se comparan: SQLite no normaliza Unicode, y
             * para eso haria falta un indice de colaciones o FTS5.
             */
            { nombre: { contains: q } },
            { documento: { contains: q } },
            { telefono: { contains: q } },
            { direccion: { contains: q } },
            /// Las notas se buscan por la relacion: viven en ClientProfile.
            { profile: { notas: { contains: q } } },
            /// El correo vive en el usuario, asi que buscarlo tiene que entrar
            /// por la relacion en vez de por un campo de la ficha.
            { user: { email: { contains: q } } },
          ],
        }
      : {}),
  };

  if (cursor) {
    const pagina = await paginaPorCursor(prisma, 'client', where, {
      cursor,
      take: limit,
      include: INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      items: pagina.items.map(fichaView),
      siguienteCursor: pagina.siguienteCursor,
      hayMas: pagina.hayMas,
    };
  }

  const { limit: tomar, offset: saltar } = pagination({ limit, offset });

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

async function getById(businessId, id) {
  const cliente = await prisma.client.findFirst({
    where: { id, businessId, deletedAt: null },
    include: INCLUDE,
  });

  if (!cliente) throw ApiError.notFound('Cliente no encontrado');

  return cliente;
}

/** Ficha completa para el modal de detalle. */
export async function detail(businessId, id) {
  return fichaView(await getById(businessId, id));
}

/** El CLIENT solo existe a traves de su propia ficha. */
export async function getSelf(user) {
  if (!user.clientId) throw ApiError.notFound('Esta cuenta no tiene ficha de cliente');

  const cliente = await prisma.client.findUnique({
    where: { id: user.clientId },
    include: INCLUDE,
  });

  if (!cliente || cliente.deletedAt) throw ApiError.notFound('Cliente no encontrado');

  return fichaView(cliente);
}

/**
 * Historial del cliente (nuevo en v2).
 *
 * Es lo primero que pide quien atiende: cuando llega un cliente, lo que hace falta
 * es "que citas ha tenido y como/le fueron", no sus datos de contacto. En v1 esa
 * informacion habia que reconstruirla a mano cruzando tres listados.
 */
export async function history(businessId, id, { limite = 50 } = {}) {
  const cliente = await getById(businessId, id);

  const [citas, eventos, totalCitas] = await Promise.all([
    prisma.appointment.findMany({
      where: { clientId: id, deletedAt: null },
      include: {
        task: { select: { id: true, title: true, category: { select: { id: true, name: true } } } },
        availability: { select: { id: true, date: true, startTime: true, endTime: true } },
        staff: { select: { id: true, nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limite) || 50, 200),
    }),
    prisma.appointmentEvent.count({
      where: { appointment: { clientId: id } },
    }),
    prisma.appointment.count({ where: { clientId: id, deletedAt: null } }),
  ]);

  return {
    cliente: fichaView(cliente),
    citas: citas.map((cita) => ({
      id: cita.id,
      status: cita.status,
      note: cita.note,
      cancelReason: cita.cancelReason,
      createdAt: cita.createdAt,
      servicio: cita.task?.title,
      categoria: cita.task?.category?.name,
      profesional: cita.staff?.nombre,
      fecha: cita.availability ? formatDateOnly(cita.availability.date) : null,
      hora: cita.availability ? `${cita.availability.startTime}-${cita.availability.endTime}` : null,
    })),
    totalCitas,
    totalEventos: eventos,
  };
}

/**
 * Alta de cliente: la cuenta de usuario y su ficha nacen juntas, porque una ficha
 * sin cuenta no puede entrar al panel ni cambiarse la contrasena.
 */
export async function create(businessId, data, req) {
  const email = data.email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw ApiError.conflict('Ese email ya esta registrado');
  }

  const esTemporal = !data.password;
  const clave = data.password || generarPasswordTemporal();

  const cliente = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        nombre: data.nombre,
        email,
        passwordHash: await hashPassword(clave),
        role: 'CLIENT',
        businessId,
      },
      select: { id: true },
    });

    await tx.userSettings.create({ data: { userId: user.id } });

    const cliente = await tx.client.create({
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

    /*
     * Las notas van a `ClientProfile`, no a `Client`.
     *
     * Estan separadas a proposito: la ficha operativa son los datos de contacto que
     * consulta el mostrador, y las notas ("alergia a la penicilina", "prefiere por la
     * manana") son historico y exportacion. Mandarlas a `Client` hacia que Prisma
     * lanzara un ValidationError y el alta devolviera un 500.
     *
     * La ficha se crea siempre, aunque venga sin notas: asi existe desde el primer
     * dia y un PUT posterior solo tiene que actualizarla.
     */
    await tx.clientProfile.upsert({
      where: { clientId: cliente.id },
      create: { clientId: cliente.id, notas: data.notas ?? null, consentimientoAt: new Date() },
      update: {},
    });

    /*
     * Se relee porque el `include` de la llamada anterior trajo un perfil que aun no
     * existia (`profile: null`). Sin esto, la respuesta del alta salia con las notas
     * vacias aunque se hubieran guardado bien, y el frontend las borraria del
     * formulario sin avisar.
     */
    return tx.client.findUnique({ where: { id: cliente.id }, include: INCLUDE });
  });

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'create',
    entity: 'Client',
    entityId: cliente.id,
    req,
  });

  return {
    cliente: fichaView(cliente),
    ...(esTemporal ? { passwordTemporal: clave } : {}),
  };
}

/**
 * Lo que la administracion puede cambiar de una ficha. Nombre, email, estado y
 * contrasena viven en la cuenta de usuario; el resto va en la ficha. Se tocan los
 * dos sitios o la lista de clientes y la cuenta dejarian de cuadrar.
 */
export async function update(businessId, id, data, req) {
  const cliente = await getById(businessId, id);
  const { nombre, email, documento, fechaNacimiento, telefono, direccion, notas, password, activo } = data;

  const actualizado = await prisma.$transaction(async (tx) => {
    const cuenta = {};
    if (nombre !== undefined) cuenta.nombre = nombre;
    if (email !== undefined) cuenta.email = email.toLowerCase();
    if (activo !== undefined) cuenta.activo = activo;

    if (password) {
      cuenta.passwordHash = await hashPassword(password);
      /*
       * Cambiar la contrasena desde aqui tambien expulsa al cliente de su sesion. Si
       * se la cambiaron porque se la comprometieron, dejarlo dentro no sirve de nada.
       */
      cuenta.tokenVersion = { increment: 1 };
    }

    if (Object.keys(cuenta).length > 0) {
      await tx.user.update({ where: { id: cliente.user.id }, data: cuenta });

      if (activo === false) {
        await tx.refreshToken.updateMany({
          where: { userId: cliente.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }

    const ficha = await tx.client.update({
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

    /*
     * Las notas viven en ClientProfile, que es una ficha aparte. Se escribe solo si
     * vienen en el cuerpo: un PUT que no las menciona NO debe borrarlas.
     */
    if (notas !== undefined) {
      await tx.clientProfile.upsert({
        where: { clientId: ficha.id },
        create: { clientId: ficha.id, notas },
        update: { notas },
      });
    }

    /*
     * Se relee porque el `include` de la llamada anterior trajo un perfil que aun no
     * tiene las notas que se acaban de escribir. Sin esto, un PUT que cambia solo las
     * notas devolveria la ficha con las notas viejas.
     */
    return tx.client.findUnique({ where: { id }, include: INCLUDE });
  });

  auditar({ businessId, actorId: req.user?.id, action: 'update', entity: 'Client', entityId: id, req });

  return fichaView(actualizado);
}

/**
 * El cliente edita su propia ficha desde el perfil. No puede tocar el rol ni el
 * estado de su cuenta: la reactivacion la decide la administracion, y la
 * contrasena se cambia por su propia via (/auth/password).
 */
export async function updateSelf(user, data, req) {
  const propia = await getSelf(user);
  return update(propia.businessId, propia.id, data, req);
}

/**
 * Baja de cliente.
 *
 * v2 la hace LOGICA por defecto (soft delete): en v1, un DELETE se llevaba por
 * delante la cuenta, las citas, los eventos de historial y las notificaciones. Un
 * cliente que cancelaba una cita y a los dos dias "era otra persona" no tenia
 * forma de recuperar nada de eso.
 *
 * Se marca `deletedAt` y se desactivan sus citas futuras en vez de destruirlas.
 * El historico queda consultable, que es lo que un negocio necesita.
 *
 * Con `?hard=true` se borra de verdad (incluso las citas), para cuando de verdad
 * hay que eliminar un dato personal. Va aparte del PATCH a proposito.
 */
export async function remove(businessId, id, req, { hard = false } = {}) {
  await getById(businessId, id);

  const citas = await prisma.appointment.findMany({
    where: { clientId: id, deletedAt: null },
    select: { availabilityId: true, taskId: true, status: true },
  });

  if (hard) {
    await prisma.$transaction(async (tx) => {
      await tx.client.delete({ where: { id } });
      await liberarHuecos(tx, citas);
      await borrarTareasHuerfanas(
        tx,
        citas.map((cita) => cita.taskId)
      );
    });

    auditar({
      businessId,
      actorId: req.user?.id,
      action: 'delete_hard',
      entity: 'Client',
      entityId: id,
      req,
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Desactiva la cuenta (no la borra) y tira sus sesiones.
    await tx.user.update({
      where: { id },
      data: { activo: false, deletedAt: new Date(), tokenVersion: { increment: 1 } },
    });
    await tx.refreshToken.updateMany({
      where: {
        userId: (await tx.client.findUnique({ where: { id }, select: { userId: true } })).userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });

    // Las citas futuras que seguian vivas se cancelan (no se borran): el hueco se
    // libera pero el historial queda. Las pasadas y las ya cerradas se dejan
    // como estaban: son el registro de lo que ocurrio.
    const futurasVivas = citas.filter((cita) => ['PENDING', 'COORDINATED'].includes(cita.status));

    /// `updateMany` en vez de un bucle de `update`: una sentencia en lugar de una
    /// por cita, para no mantener el unico lock de escritura de SQLite abierto.
    await tx.appointment.updateMany({
      where: { id: { in: futurasVivas.map((cita) => cita.id) } },
      data: { status: 'CANCELLED', cancelReason: 'Cliente dado de baja' },
    });

    /// Y sus recordatorios pendientes se cancelan con ellas: sin esto el worker
    /// mandaba avisos de citas que la baja del cliente acababa de cancelar.
    await tx.reminder.updateMany({
      where: { appointmentId: { in: futurasVivas.map((cita) => cita.id) }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    await liberarHuecos(tx, futurasVivas);
    await borrarTareasHuerfanas(
      tx,
      futurasVivas.map((cita) => cita.taskId)
    );
  });

  auditar({ businessId, actorId: req.user?.id, action: 'delete', entity: 'Client', entityId: id, req });
}

/** Una tarea que se creo para una cita y ya no tiene ninguna no aporta nada. */
async function borrarTareasHuerfanas(tx, taskIds) {
  const ids = [...new Set(taskIds)].filter(Boolean);
  if (ids.length === 0) return;

  const huerfanas = await tx.task.findMany({
    where: { id: { in: ids }, appointments: { none: {} } },
    select: { id: true },
  });

  if (huerfanas.length > 0) {
    await tx.task.deleteMany({ where: { id: { in: huerfanas.map((t) => t.id) } } });
  }
}

export default { list, detail, getSelf, history, create, update, updateSelf, remove };
