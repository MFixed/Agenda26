import { clientePublico, usuarioPublico } from "../utils/serialize.js";
import { prisma } from "../config/database.js";
import * as authService from "../services/auth.service.js";
import { parseCambioPassword, parseLogin, parseRegistro } from "../validators/auth.validator.js";

/** POST /api/auth/register — alta de cliente (User + Client en una transacción). */
export async function registrar(request, response) {
  const datos = parseRegistro(request.body);
  const { usuario, token } = await authService.registrarCliente(datos);
  const negocio = await prisma.business.findUnique({ where: { id: usuario.businessId } });
  response.status(201).json({
    token,
    user: usuarioPublico(usuario),
    client: clientePublico(usuario.client),
    negocio: negocio ? { nombre: negocio.nombre, slug: negocio.slug } : null
  });
}

/** POST /api/auth/login */
export async function entrar(request, response) {
  const datos = parseLogin(request.body);
  const { usuario, token } = await authService.autenticarUsuario(datos);
  response.json({
    token,
    user: usuarioPublico(usuario),
    client: clientePublico(usuario.client),
    negocio: usuario.business ? { nombre: usuario.business.nombre, slug: usuario.business.slug } : null
  });
}

/**
 * POST /api/auth/logout
 * El JWT es sin estado: no hay sesión en el servidor que revocar. Cerrar sesión
 * consiste en que el cliente olvide el token; si en el futuro se añade una lista
 * de tokens revocados, este es el sitio donde hacerlo.
 */
export function salir(request, response) {
  response.json({ ok: true });
}

/** GET /api/auth/me */
export function yo(request, response) {
  response.json({
    user: usuarioPublico(request.user),
    client: request.cliente ?? null,
    negocio: request.business ? { nombre: request.business.nombre, slug: request.business.slug } : null
  });
}

/** POST /api/auth/password */
export async function cambiarPassword(request, response) {
  const datos = parseCambioPassword(request.body);
  await authService.cambiarPassword(request.user, datos);
  response.json({ ok: true, mensaje: "Contraseña actualizada." });
}
