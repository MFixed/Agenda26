import { prisma } from '../../config/driver.js';
import { ApiError } from '../utils/ApiError.js';
import { verificarAccessToken } from '../utils/tokens.js';

/**
 * Autenticacion y autorizacion.
 *
 * El JWT lleva dentro la version del token del usuario (`ver`). La base la
 * tiene tambien, y `authenticate` las compara en cada peticion: si no coinciden,
 * el token ya no vale.
 *
 * Consultar la base en cada peticion mantiene `activo` y `role` frescos sin
 * depender del contenido del token, y es donde se comprueba la version. El coste
 * es una consulta, que ya se hacia de todos modos para saber si la cuenta sigue
 * viva. A cambio, desactivar a un usuario surte efecto en la siguiente peticion
 * y no cuando caduque su token.
 */

/**
 * Verifica el token y recarga el usuario.
 *
 * Un JWT es sin estado, asi que por si solo no hay forma de invalidarlo; subir
 * `tokenVersion` es la version barata de tener una lista de revocados, y no
 * necesita ni memoria ni Redis: vive en la base, que ya esta ahi.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw ApiError.unauthorized('Falta el token de autorizacion');
  }

  const payload = verificarAccessToken(token);

  if (!payload) {
    throw ApiError.unauthorized('Token invalido o expirado');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: {
      client: { select: { id: true, businessId: true } },
      staff: { select: { id: true } },
    },
  });

  if (!user || !user.activo || user.deletedAt) {
    throw ApiError.unauthorized('Usuario no encontrado o inactivo');
  }

  /// Token emitido antes de un cierre de sesion, de un cambio de contrasena o de
  /// una baja: el mismo mensaje que el de un token caducado, para no contarle
  /// al que lo tiene cuantos caminos hay para dejarlo fuera.
  if ((payload.ver ?? 0) !== user.tokenVersion) {
    throw ApiError.unauthorized('Token invalido o expirado');
  }

  req.user = {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    role: user.role,
    businessId: user.businessId,
    clientId: user.client?.id ?? null,
    staffId: user.staff?.id ?? null,
  };

  next();
}

/** Restringe una ruta a los roles indicados. El permiso se decide aqui, no en el service. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden('No tienes permisos para esta accion');
    }

    next();
  };
}

/** ADMIN y SUPERADMIN: administracion de la empresa. */
export const requireStaff = requireRole('ADMIN', 'SUPERADMIN');

/** ADMIN, STAFF y SUPERADMIN: cualquiera que trabaja en la empresa. */
export const requireEquipo = requireRole('ADMIN', 'STAFF', 'SUPERADMIN');

/**
 * Negocio sobre el que opera la peticion.
 *
 * El SUPERADMIN puede entrar con `?businessId=`; los demas usuarios quedan atados
 * a su propio negocio e intentar operar sobre otro devuelve 403.
 */
export function resolveBusinessId(req) {
  const requested = req.query.businessId ? Number(req.query.businessId) : null;

  if (req.user.role === 'SUPERADMIN') {
    if (!requested) {
      throw ApiError.badRequest('El SUPERADMIN debe indicar ?businessId=');
    }

    return requested;
  }

  if (!req.user.businessId) {
    throw ApiError.forbidden('Tu usuario no esta asociado a un negocio');
  }

  if (requested && requested !== req.user.businessId) {
    throw ApiError.forbidden('No puedes operar sobre otro negocio');
  }

  return req.user.businessId;
}

/**
 * Recarga el negocio con su configuracion.
 *
 * `timezone`, `bufferMin` y `slotMinutes` estan en `Business`, asi que cada
 * calculo de agenda los necesita. Cargarlos una vez por peticion y ponerlos en
 * `req.business` evita repetir la consulta en el service y, sobre todo, garantiza
 * que todos los calculos de una misma peticion usan los MISMOS valores: si dos
 * servicios leyeran el negocio por separado y alguien lo cambiara entre medias,
 * un hueco se crearia con un margen y otro con otro.
 */
export async function withBusiness(req, _res, next) {
  const businessId = resolveBusinessId(req);

  const business = await prisma.business.findFirst({
    where: { id: businessId, deletedAt: null },
    include: { settings: true },
  });

  if (!business) {
    throw ApiError.notFound('Negocio no encontrado');
  }

  if (!business.activo && req.user.role !== 'SUPERADMIN') {
    throw ApiError.forbidden('Este negocio esta desactivado');
  }

  req.business = business;
  req.businessId = businessId;

  next();
}

export default { authenticate, requireRole, requireStaff, requireEquipo, resolveBusinessId, withBusiness };
