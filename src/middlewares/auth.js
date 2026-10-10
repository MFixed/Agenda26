import jwt from 'jsonwebtoken';
import { prisma } from '../../config/driver.js';
import { env } from '../../config/env.js';
import { ApiError } from '../utils/errorHandler.js';

/**
 * El JWT lleva la version del token del usuario dentro (`ver`). La base la
 * tiene tambien, y `authenticate` las compara en cada peticion: si no coinciden,
 * el token ya no vale.
 *
 * Es lo que hace que cerrar sesion y cambiar la contrasena expulsen de verdad.
 * Un JWT es sin estado, asi que por si solo no hay forma de invalidarlo; subir
 * `tokenVersion` es la version barato de tener una lista de revocados, y no
 * necesita ni memoria ni Redis: vive en la base, que ya esta ahi.
 *
 * El coste es una columna mas y un entero mas en cada peticion, que ya
 * estaba consultando al usuario de todos modos.
 */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, ver: user.tokenVersion ?? 0 },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn,
    }
  );
}

/**
 * Verifica el token y recarga el usuario. Preguntar a la base en cada request
 * mantiene activo/role frescos sin depender del contenido del JWT, y de paso
 * es donde se comprueba la version del token.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw ApiError.unauthorized('Falta el token de autorizacion');
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw ApiError.unauthorized('Token invalido o expirado');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { client: { select: { id: true, businessId: true } } },
  });

  if (!user || !user.activo) {
    throw ApiError.unauthorized('Usuario no encontrado o inactivo');
  }

  // Token emitido antes de un cierre de sesion o de un cambio de contrasena: el
  // mismo mensaje que el de un token caducado, para no contarle al que lo
  // tiene cuantos caminos hay para dejarlo sin sesion.
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
  };

  next();
}

/** Restringe una ruta a los roles indicados. */
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

/**
 * Negocio sobre el que opera la peticion. El SUPERADMIN puede entrar con
 * ?businessId= ; los demas usuarios quedan atados a su propio negocio.
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