import { prisma } from "../config/database.js";
import { AppError, conflicto, noAutorizado, noEncontrado } from "../utils/http.js";
import { firmarToken } from "../utils/jwt.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { aMedianocheUTC } from "../utils/date.js";

/**
 * Hash señuelo: si el correo no existe se verifica igualmente la contraseña
 * contra un hash generado al vuelo, para que el tiempo de respuesta no revele
 * qué correos están dados de alta.
 */
let hashSenuelo = null;
async function verificarContraSenuelo(password) {
  if (!hashSenuelo) {
    hashSenuelo = hashPassword("contrasena-inexistente-000");
  }
  return verifyPassword(password, await hashSenuelo);
}

function emailEnUso(email) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

function documentoEnUso(businessId, documento) {
  if (!documento) {
    return null;
  }
  return prisma.client.findUnique({
    where: { businessId_documento: { businessId, documento } },
    select: { id: true }
  });
}

/** Localiza el negocio por su slug o falla con un 404 amable. */
export async function buscarNegocioPorSlug(slug) {
  const negocio = await prisma.business.findUnique({ where: { slug } });
  if (!negocio) {
    throw noEncontrado("Ese negocio no existe. Revisa la dirección.");
  }
  if (!negocio.activo) {
    throw new AppError(403, "Ese negocio está desactivado.");
  }
  return negocio;
}

/**
 * Alta de cliente: User + Client en la misma transacción, o no se crea ninguno.
 * El rol y el negocio los decide el servidor (el negocio, por su slug), nunca
 * el cuerpo de la petición.
 */
export async function registrarCliente(datos) {
  const negocio = await buscarNegocioPorSlug(datos.negocio);
  if (await emailEnUso(datos.email)) {
    throw conflicto("Ya existe una cuenta con ese correo electrónico.");
  }
  if (await documentoEnUso(negocio.id, datos.documento)) {
    throw conflicto("Ya existe un cliente con ese documento en este negocio.");
  }

  const passwordHash = await hashPassword(datos.password);

  const usuario = await prisma.user.create({
    data: {
      nombre: datos.nombre,
      email: datos.email,
      passwordHash,
      role: "CLIENT",
      businessId: negocio.id,
      client: {
        create: {
          businessId: negocio.id,
          nombre: datos.nombre,
          documento: datos.documento,
          fechaNacimiento: aMedianocheUTC(datos.fechaNacimiento),
          telefono: datos.telefono,
          direccion: datos.direccion
        }
      }
    },
    include: { client: true }
  });

  return { usuario, token: firmarToken(usuario) };
}

export async function autenticarUsuario({ email, password, negocio }) {
  const usuario = await prisma.user.findUnique({
    where: { email },
    include: { client: true, business: true }
  });

  const coincide = usuario
    ? await verifyPassword(password, usuario.passwordHash)
    : await verificarContraSenuelo(password);

  // Mensaje idéntico en los dos casos: no revelamos si el correo existe.
  if (!usuario || !coincide) {
    throw noAutorizado("Correo o contraseña incorrectos.");
  }
  if (!usuario.activo) {
    throw new AppError(403, "Tu cuenta está desactivada. Contacta con la administración.");
  }

  /* El negocio decide por la cuenta: un admin o un cliente no puede entrar por
     la puerta de una empresa que no es suya, y el superadmin sólo por /login.
     Estas comprobaciones van DESPUÉS de validar la contraseña a propósito: si se
     pusieran antes, el mensaje y el tiempo de respuesta dirían si una cuenta
     existe y a qué empresa pertenece, que es información para quien no tiene
     ninguna credencial. */
  if (usuario.role === "SUPERADMIN") {
    if (negocio) {
      throw superadminSinPuertaDeEmpresa();
    }
  } else {
    if (!negocio) {
      throw noAutorizado("Entra por la dirección de tu negocio.");
    }
    // Antes de comparar slugs, que la empresa exista y esté activa: si no, el
    // mensaje sería "tu cuenta no pertenece a ese negocio" para una empresa
    // desactivada, que no es lo que pasó.
    if (!usuario.business) {
      throw new AppError(403, "Tu cuenta no está vinculada a ninguna empresa. Contacta con la plataforma.");
    }
    if (!usuario.business.activo) {
      throw new AppError(403, "Tu negocio está desactivado.");
    }
    if (usuario.business.slug !== negocio) {
      throw noAutorizado("Tu cuenta no pertenece a ese negocio.");
    }
  }

  await prisma.user.update({
    where: { id: usuario.id },
    data: { ultimoAcceso: new Date() }
  });

  return { usuario, token: firmarToken(usuario) };
}

function superadminSinPuertaDeEmpresa() {
  return noAutorizado("Esa cuenta no pertenece a ningún negocio: entra desde /login.");
}

export function buscarUsuario(id) {
  return prisma.user.findUnique({ where: { id }, include: { client: true, business: true } });
}

/** Cambio de contraseña propio, exigiendo la actual. */
export async function cambiarPassword(usuario, { passwordActual, passwordNueva }) {
  const correcta = await verifyPassword(passwordActual, usuario.passwordHash);
  if (!correcta) {
    throw noAutorizado("La contraseña actual no es correcta.");
  }
  await prisma.user.update({
    where: { id: usuario.id },
    data: { passwordHash: await hashPassword(passwordNueva) }
  });
}
