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

  const usuario = await prisma.user.findUnique({ where: { id: Number(contenido.sub) } });
  if (!usuario) {
    throw noAutorizado("La cuenta ya no existe.");
  }
  if (!usuario.activo) {
    throw prohibido("Tu cuenta está desactivada. Contacta con la administración.");
  }

  request.user = usuario;
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
  return usuarioPublico(request.user);
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
