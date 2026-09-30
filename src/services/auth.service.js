import { prisma } from "../config/database.js";
import { AppError, conflicto, noAutorizado } from "../utils/http.js";
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

function documentoEnUso(documento) {
  if (!documento) {
    return null;
  }
  return prisma.client.findUnique({ where: { documento }, select: { id: true } });
}

/**
 * Alta de cliente: User + Client en la misma transacción, o no se crea ninguno.
 * El rol lo pone la función, nunca el cuerpo de la petición.
 */
export async function registrarCliente(datos) {
  if (await emailEnUso(datos.email)) {
    throw conflicto("Ya existe una cuenta con ese correo electrónico.");
  }
  if (await documentoEnUso(datos.documento)) {
    throw conflicto("Ya existe un cliente con ese documento.");
  }

  const passwordHash = await hashPassword(datos.password);

  const usuario = await prisma.user.create({
    data: {
      nombre: datos.nombre,
      email: datos.email,
      passwordHash,
      role: "CLIENT",
      client: {
        create: {
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

export async function autenticarUsuario({ email, password }) {
  const usuario = await prisma.user.findUnique({
    where: { email },
    include: { client: true }
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

  await prisma.user.update({
    where: { id: usuario.id },
    data: { ultimoAcceso: new Date() }
  });

  return { usuario, token: firmarToken(usuario) };
}

export function buscarUsuario(id) {
  return prisma.user.findUnique({ where: { id }, include: { client: true } });
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
