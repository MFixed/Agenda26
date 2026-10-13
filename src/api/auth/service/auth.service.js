import { randomBytes } from 'node:crypto';
import { prisma } from '../../../../config/driver.js';
import { hashToken, logger } from '../../../../config/logger.js';
import { ApiError } from '../../../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../../../utils/password.js';
import { firmarAccessToken, duracionRefresh } from '../../../utils/tokens.js';
import { parseDateOnly } from '../../../utils/dates.js';
import { auditar } from '../../../utils/audit.js';

const USER_SELECT = {
  id: true,
  nombre: true,
  email: true,
  role: true,
  activo: true,
  ultimoAcceso: true,
  emailVerifiedAt: true,
  businessId: true,
  /// Va en el JWT para poder invalidarlo. Nunca se devuelve al cliente: `sesion`
  /// lo saca de la respuesta igual que saca `passwordHash`.
  tokenVersion: true,
};

/**
 * Lo que el cliente ve de un usuario: sin `tokenVersion`, `passwordHash` ni
 * `deletedAt`.
 *
 * Se quita por lista blanca de CLAVES A GUARDAR y no desestructurando las que no
 * queremos: desestructurar para descartar ensucia el codigo con variables
 * muertas que el linter senala, y el dia que se anada un campo sensible al
 * `select` vuelve a colarse sin que nadie se entere.
 */
const CAMPOS_PRIVADOS = new Set(['tokenVersion', 'passwordHash', 'deletedAt']);

const USER_PUBLICO = (user) =>
  Object.fromEntries(Object.entries(user).filter(([clave]) => !CAMPOS_PRIVADOS.has(clave)));

const NEGOCIO_SELECT = {
  id: true,
  nombre: true,
  slug: true,
  descripcion: true,
  /// Necesario para poder decidir si la empresa tiene la puerta abierta.
  activo: true,
  timezone: true,
};

/**
 * Emite un par access + refresh.
 *
 * El refresh token se guarda HASHEADO: si alguien lee la tabla no puede
 * Presentedarlos como sesion valida. Solo existe en claro en la respuesta.
 */
async function emitirSesion(user, negocio, req, { esNuevo = false } = {}) {
  const enClaro = randomBytes(48).toString('base64url');
  const { fecha, segundos } = duracionRefresh();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(enClaro),
      expiresAt: fecha,
      userAgent: req?.get?.('user-agent')?.slice(0, 500) ?? null,
      ip: req?.ip ?? null,
    },
  });

  return {
    accessToken: firmarAccessToken(user),
    refreshToken: enClaro,
    /// En segundos. El frontend lo usa para saber cuando tiene que renovar en
    /// vez de esperar a que caduque y le tire un 401 a mitad de formulario.
    expiresIn: segundos,
    tokenType: 'Bearer',
    esNuevo,
    user: USER_PUBLICO(user),
    negocio,
  };
}

/**
 * Hash de relleno para igualar el coste del login.
 *
 * Es un scrypt REAL de una contrasena que no se usa para nada, con un salt fijo de
 * ceros. Cuando el email no existe se verifica contra este, de forma que el
 * atacante que cronometra el login ve siempre el mismo coste y no puede deducir
 * que correos estan registrados. El hash es publico a proposito: no protege
 * nada, solo hace de relleno.
 */
const HASH_FICTICIO =
  'scrypt$00000000000000000000000000000000$34ac9176638ffce57768f57b4d94bf8aab834b07863b6337993f11a030f05079eb948fa11485c928330f7c3dd1e4952d599ffe4ba5df7968637a51bca2571b0a';

async function buscarNegocio(slug) {
  const negocio = await prisma.business.findFirst({
    where: { slug, deletedAt: null },
    select: NEGOCIO_SELECT,
  });

  /// Una empresa desactivada se comporta como si no existiera: sus puertas ya no
  /// sirven y conviene no confirmar que hay algo detras.
  if (!negocio || !negocio.activo) {
    throw ApiError.notFound('No encontramos ningun negocio con ese identificador');
  }

  return negocio;
}

/**
 * Registro publico por la puerta de una empresa: siempre crea una cuenta CLIENT
 * ligada a ese negocio. Los roles ADMIN, STAFF y SUPERADMIN los crea el equipo de
 * la empresa, nunca un visitante.
 */
/**
 * Alta publica por la puerta de una empresa.
 *
 * La cuenta se crea YA VERIFICADA (`emailVerifiedAt`), porque este alta no es un
 * signup abierto a internet: es la puerta de una empresa concreta, y quien llega
 * con un formulario de "reserve cita" en una web que el negocio controla.
 *
 * Antes la columna se quedaba en `NULL` para siempre: el `schema.prisma` decia
 * "el alta es provisional hasta que se confirme el correo", pero no habia ni
 * endpoint de verificacion, ni correo, ni nada que la rellenara, y el login no
 * miraba el campo. Es decir, la columna decia una cosa y el codigo hacia otra.
 *
 * Se marca como verificada para que el estado guardado sea el real. Cuando se
 * quiera exigir la confirmacion de verdad, el camino esta limpio: basta con NO
 * rellenar este campo aqui y anadir el endpoint que lo rellene.
 */
export async function register(
  { nombre, documento, fechaNacimiento, email, password, telefono, direccion, negocio: slug, emailOptIn },
  req
) {
  const business = await buscarNegocio(slug);
  const emailNormalizado = email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email: emailNormalizado }, select: { id: true } })) {
    /// El registro publico es la puerta abierta de la plataforma: un mensaje que
    /// dijera "ese email ya existe" permitiria recorrer correos y sacar la lista
    /// de clientes. El mensaje no dice que campo fue el que choco.
    throw ApiError.conflict('No se pudo completar el alta con esos datos');
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const creado = await tx.user.create({
      data: {
        nombre,
        email: emailNormalizado,
        passwordHash,
        role: 'CLIENT',
        businessId: business.id,
        /// Ver en la nota de la funcion. Sin esto la cuenta nace en un estado que
        /// no corresponde.
        emailVerifiedAt: new Date(),
      },
      select: USER_SELECT,
    });

    await tx.client.create({
      data: {
        userId: creado.id,
        businessId: business.id,
        nombre,
        documento,
        fechaNacimiento: parseDateOnly(fechaNacimiento),
        telefono,
        direccion,
      },
    });

    await tx.userSettings.create({
      data: { userId: creado.id, emailOptIn: emailOptIn ?? true },
    });

    return creado;
  });

  auditar({
    businessId: business.id,
    actorId: user.id,
    action: 'register',
    entity: 'User',
    entityId: user.id,
    req,
  });

  return emitirSesion(user, business, req, { esNuevo: true });
}

export async function login({ email, password, negocio: slug }, req) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      ...USER_SELECT,
      passwordHash: true,
      deletedAt: true,
      business: { select: NEGOCIO_SELECT },
    },
  });

  /*
   * El scrypt corre SIEMPRE, exista la cuenta o no.
   *
   * Con un cortocircuito (`user && ... && await verifyPassword(...)`) un email
   * inexistente respondia en un milisegundo y uno existente tardaba el scrypt
   * entero: el mensaje era el mismo, pero el tiempo no, y eso basta para recorrer
   * cualesquiera correos y sacar la lista de clientes de la plataforma.
   *
   * Cuando no hay usuario se verifica contra un hash ficticio de forma fija, de
   * modo que los dos caminos cuesten lo mismo.
   */
  const contraElHash = user?.passwordHash ?? HASH_FICTICIO;
  const coincide = await verifyPassword(password, contraElHash);

  const ok = Boolean(user) && user.activo && !user.deletedAt && coincide;

  /// Mismo mensaje para email inexistente y password incorrecta: no revelamos que
  /// cuentas estan registradas.
  if (!ok) {
    throw ApiError.unauthorized('Credenciales invalidas');
  }

  /// Cada empresa tiene su propia puerta. Entrar por /b/otra-empresa con una
  /// cuenta que no es de ahi no es un error de credenciales, es de empresa.
  if (slug && user.business?.slug !== slug) {
    throw ApiError.forbidden('Esta cuenta no pertenece a ese negocio');
  }

  if (user.business && !user.business.activo) {
    throw ApiError.forbidden('Este negocio esta desactivado');
  }

  const { business, ...datos } = user;
  const ultimoAcceso = new Date();

  await prisma.user.update({ where: { id: user.id }, data: { ultimoAcceso } });

  auditar({
    businessId: user.businessId,
    actorId: user.id,
    action: 'login',
    entity: 'User',
    entityId: user.id,
    req,
  });

  return emitirSesion({ ...datos, ultimoAcceso }, business, req);
}

/**
 * Estado de la sesion. El frontend lo usa para pintar nombre, rol y cifras, y
 * para decidir a que panel va.
 */
export async function me(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...USER_SELECT,
      business: { select: NEGOCIO_SELECT },
      client: { select: { id: true } },
      staff: { select: { id: true, nombre: true, especialidad: true, color: true } },
      settings: { select: { emailOptIn: true, locale: true, timezone: true, theme: true } },
    },
  });

  if (!user) {
    throw ApiError.notFound('Usuario no encontrado');
  }

  const { business, client, staff, settings, ...datos } = user;

  const citas = client
    ? await prisma.appointment.count({ where: { clientId: client.id, deletedAt: null } })
    : 0;

  return { user: USER_PUBLICO(datos), negocio: business, staff, settings, citas };
}

/**
 * Cierre de sesion.
 *
 * `tokenVersion` es algo global al usuario: subirlo invalida los access
 * tokens de TODOS sus dispositivos a la vez. Por eso solo se sube cuando la
 * peticion es "cerrar sesion en todas partes" (o el logout no trae token, que es
 * el caso en que no se sabe cual sesion era).
 *
 * Con `todos=false` y un token concreto solo se revoca ESE refresh token. Antes se
 * incrementaba `tokenVersion` igual, y el resultado era un estado incoherente: los
 * access tokens de los otros dispositivos caian al instante pero sus refresh
 * tokens seguian vivos, y en cuanto uno renovaba seuania una sesion nueva. El
 * usuario cerraba sesion en el movil y se le caia el panel del ordenador "sin
 * motivo".
 */
export async function logout(userId, refreshToken, { todos = false } = {}) {
  const esGlobal = todos || !refreshToken;

  await prisma.$transaction([
    ...(esGlobal
      ? [
          prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]
      : [
          prisma.refreshToken.updateMany({
            where: { userId, tokenHash: hashToken(refreshToken), revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]),

    ...(esGlobal
      ? [prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })]
      : []),
  ]);
}

export async function listSessions(userId) {
  const sesiones = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return sesiones;
}

export async function revokeSession(userId, sessionId) {
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0) {
    throw ApiError.notFound('Sesion no encontrada');
  }
}

/**
 * Renovar el access token.
 *
 * El refresh token rota en cada uso: el antiguo queda revocado y se emite otro.
 * Si alguien robo un refresh token, en cuanto el titular lo use una vez los dos
 * dejan de servir a la vez y el robo queda a la vista.
 */
export async function refresh(refreshToken, req) {
  const tokenHash = hashToken(refreshToken);

  const guardado = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          ...USER_SELECT,
          deletedAt: true,
          business: { select: NEGOCIO_SELECT },
        },
      },
    },
  });

  const invalido =
    !guardado ||
    guardado.revokedAt ||
    guardado.expiresAt < new Date() ||
    !guardado.user.activo ||
    guardado.user.deletedAt;

  if (invalido) {
    throw ApiError.unauthorized('Sesion no valida. Vuelve a entrar.');
  }

  /**
   * La revocacion tiene que ser CONDICIONAL y atomica.
   *
   * Con `update({ where: { id } })` el "comprobar y revocar" son dos sentencias
   * sueltas: dos peticiones con el mismo refresh token pueden leerse las dos con
   * `revokedAt === null`, pasar el chequeo, y revocar la misma fila. Las dos
   * emiten sesion nueva y el que robo el token se queda con la suya.
   *
   * `updateMany` con `revokedAt: null` en el filtro hace el compare-and-set en una
   * sola sentencia: el segundoaker se encuentra con `count === 0` y se le dice
   * que la sesion no vale. A partir de ahi la rotacion es de verdad "un token, un
   * uso".
   */
  const { count: revocados } = await prisma.refreshToken.updateMany({
    where: { id: guardado.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (revocados === 0) {
    /// El token ya se uso: eso es exactamente lo que pasa cuando alguien intenta
    /// reutilizar uno viejo. Se avisa, que es la unica pista de un robo real.
    logger.warn('refresh token reutilizado', { userId: guardado.userId });
    throw ApiError.unauthorized('Sesion no valida. Vuelve a entrar.');
  }

  auditar({
    businessId: guardado.user.businessId,
    actorId: guardado.userId,
    action: 'refresh',
    entity: 'User',
    entityId: guardado.userId,
    req,
  });

  const { business, ...datos } = guardado.user;

  return emitirSesion(datos, business, req);
}

/**
 * Cambio de contrasena.
 *
 * Sube `tokenVersion` y revoca todos los refresh tokens: si alguien robo la
 * sesion, cambiar la clave lo deja fuera de verdad. La sesion de quien cambia la
 * contrasena tampoco sobrevive.
 */
export async function changePassword(userId, { passwordActual, passwordNueva }, req) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

  if (!user || !(await verifyPassword(passwordActual, user.passwordHash))) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'passwordActual', message: 'La contrasena actual no es correcta' },
    ]);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(passwordNueva), tokenVersion: { increment: 1 } },
    }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  auditar({ actorId: userId, action: 'password_change', entity: 'User', entityId: userId, req });

  return { mensaje: 'Contrasena actualizada. Vuelve a entrar con la nueva contrasena.' };
}

export async function getSettings(userId) {
  return prisma.userSettings.findUnique({
    where: { userId },
    select: { emailOptIn: true, locale: true, timezone: true, theme: true, updatedAt: true },
  });
}

export async function updateSettings(userId, data) {
  const { timezone, ...resto } = data;

  return prisma.userSettings.upsert({
    where: { userId },
    /// En el create se ignoran los campos opcionales: se rellenan con default.
    create: { userId, ...resto, ...(timezone ? { timezone } : {}) },
    update: { ...resto, ...(timezone !== undefined ? { timezone } : {}) },
    select: { emailOptIn: true, locale: true, timezone: true, theme: true, updatedAt: true },
  });
}

export default {
  register,
  login,
  me,
  logout,
  refresh,
  changePassword,
  listSessions,
  revokeSession,
  getSettings,
  updateSettings,
};
