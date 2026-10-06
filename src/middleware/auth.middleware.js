import { prisma } from "../config/database.js";
import { AppError, asincrono, noAutorizado, prohibido } from "../utils/http.js";
import { extraerToken, verificarToken } from "../utils/jwt.js";
import { usuarioPublico } from "../utils/serialize.js";

/**
 * authenticate
 *
 * Exige un JWT válido y deja en request.user el usuario leído de la base de
 * datos. No se fía del rol que lleva el token: una cuenta desactivada o un rol
 * cambiado surten efecto de inmediato, sin esperar a que caduque.
 */
export const authenticate = asincrono(async (request, response, next) => {
  const token = extraerToken(request);
  const contenido = verificarToken(token);

  const usuario = await prisma.user.findUnique({ where: { id: Number(contenido.sub) }, include: { business: true } });
  if (!usuario) {
    throw noAutorizado("La cuenta ya no existe.");
  }
  if (!usuario.activo) {
    throw prohibido("Tu cuenta está desactivada. Contacta con la administración.");
  }
  if (usuario.business && !usuario.business.activo) {
    throw prohibido("Tu negocio está desactivado. Contacta con la plataforma.");
  }

  request.user = usuario;
  request.business = usuario.business ?? null;
  request.token = token;
  next();
});

/**
 * Adjunta a request.cliente el perfil del cliente, o null si la cuenta es de un
 * administrador. Se consulta siempre por userId: es la única fuente fiable del
 * perfil y así el service no necesita caches ni volver a pedirlo.
 */
export const cargarCliente = asincrono(async (request, response, next) => {
  request.cliente =
    request.user.role === "ADMIN"
      ? null
      : await prisma.client.findUnique({
          where: { userId: request.user.id },
          include: { _count: { select: { appointments: true, tasks: true } } }
        });
  next();
});

/** Identidad del usuario en JSON, sin passwordHash. */
export function identidad(request) {
  return { ...usuarioPublico(request.user), negocio: request.business ? { nombre: request.business.nombre, slug: request.business.slug } : null };
}

/** requireAdmin / requireClient: cortocircuito por rol, siempre tras authenticate. */
export function requireAdmin(request, response, next) {
  if (request.user.role !== "ADMIN") {
    return next(prohibido("Esta sección es sólo para administradores."));
  }
  return next();
}

export function requireClient(request, response, next) {
  if (request.user.role !== "CLIENT") {
    return next(prohibido("Esta sección es sólo para clientes."));
  }
  return next();
}

export function requireSuperAdmin(request, response, next) {
  if (request.user.role !== "SUPERADMIN") {
    return next(prohibido("Esta sección es sólo para el equipo de la plataforma."));
  }
  return next();
}

/**
 * Cada dato de la aplicación cuelga de una empresa, así que una petición sin
 * `businessId` no tiene a qué empresa preguntar. Es el caso del
 * superadministrador: gestiona los negocios, no trabaja dentro de ninguno.
 *
 * Sin este cortocircuito, `businessId: null` llegaba al servicio y de ahí a
 * Prisma, que rechaza un filtro sobre una columna no nulable y devolvía un 500.
 * Un 500 dice "se ha roto algo"; lo que ocurre es que esa ruta no le corresponde
 * a ese rol, que es un 403 y se puede arreglar desde el frontend.
 *
 * Va en el `use()` de cada router de empresa, DESPUÉS de `authenticate` y nunca
 * antes: sin sesión, `request.user` no existe todavía y lo que debe contestar la
 * ruta es el 401 que pone `authenticate`, no un 403 sobre una petición sin
 * identidad. Montado en el `use()` del router y no ruta a ruta, una ruta nueva
 * nace protegida por defecto en lugar de por accidente.
 */
export function requireEmpresa(request, response, next) {
  if (!request.user.businessId) {
    return next(prohibido("Esta sección es de una empresa concreta. Tu cuenta es de la plataforma."));
  }
  return next();
}

/**
 * El businessId de la cuenta: presente para ADMIN y CLIENT, null para el
 * SUPERADMIN. Acompaña siempre a las consultas de negocio para que nada cruce
 * de un negocio a otro.
 */
export function businessIdDe(request) {
  return request.user.businessId ?? null;
}

/**
 * Un ADMIN puede actuar sobre cualquier cliente; un CLIENT sólo sobre el suyo.
 * Se usa en /api/clients/:id y en las citas para no confiar en el ID que manda
 * el frontend.
 */
export function esDueñoOAdmin(request, recurso) {
  if (request.user.role === "ADMIN") {
    return true;
  }
  const duenio = recurso?.userId ?? recurso?.client?.userId ?? null;
  return duenio !== null && duenio === request.user.id;
}

export function exigirDueñoOAdmin(request, recurso) {
  if (!esDueñoOAdmin(request, recurso)) {
    throw new AppError(403, "No tienes permisos para ver esta información.");
  }
}
