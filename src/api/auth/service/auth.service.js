import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/errorHandler.js';
import { hashPassword, verifyPassword } from '../../../utils/password.js';
import { parseDateOnly } from '../../../utils/dates.js';
import { signToken } from '../../../middlewares/auth.js';

const USER_SELECT = {
  id: true,
  nombre: true,
  email: true,
  role: true,
  activo: true,
  ultimoAcceso: true,
  businessId: true,
  // Va en el JWT para poder invalidarlo al cerrar sesion o cambiar la
  // contrasena. No se devuelve nunca al cliente: `sesion` lo saca de la
  // respuesta igual que saca `passwordHash`.
  tokenVersion: true,
};

/** Lo que el cliente ve de un usuario. Sin `tokenVersion` ni `passwordHash`. */
const USER_PUBLICO = (user) => {
  const { tokenVersion, passwordHash, ...visible } = user;
  return visible;
};

const NEGOCIO_SELECT = {
  id: true,
  nombre: true,
  slug: true,
  descripcion: true,
  // Necesario para poder decidir si la empresa tiene la puerta abierta.
  activo: true,
};

/**
 * Lo que devuelve un acceso correcto. El frontend guarda el token, se queda con
 * el negocio para saber a que puerta volver si caduca, y manda al panel que
 * corresponde al rol.
 */
function sesion(user, negocio) {
  return { token: signToken(user), user: USER_PUBLICO(user), negocio };
}

async function buscarNegocio(slug) {
  const negocio = await prisma.business.findUnique({ where: { slug }, select: NEGOCIO_SELECT });

  // Una empresa desactivada se comporta como si no existiera: sus puertas ya
  // no sirven y conviene no confirmar que hay algo detras.
  if (!negocio || !negocio.activo) {
    throw ApiError.notFound('No encontramos ningun negocio con ese identificador');
  }

  return negocio;
}

/**
 * Registro publico por la puerta de una empresa: siempre crea una cuenta CLIENT
 * ligada a ese negocio. Los roles ADMIN y SUPERADMIN los crea el equipo de la
 * plataforma, nunca un visitante.
 */
export async function register({ nombre, documento, fechaNacimiento, email, password, telefono, direccion, negocio: slug }) {
  const business = await buscarNegocio(slug);

  const emailNormalizado = email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email: emailNormalizado }, select: { id: true } })) {
    // El registro publico es la puerta abierta de la plataforma: un mensaje
    // que dijera "ese email ya existe" permitiria recorrer correos y sacar la
    // lista de clientes. El mensaje no dice que campo fue el que choco. Quien
    // esta de verdad registrandose ve algo raro y prueba a entrar; quien esta
    // barriendo emails no gana nada.
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

    return creado;
  });

  return sesion(user, business);
}

export async function login({ email, password, negocio: slug }) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      ...USER_SELECT,
      passwordHash: true,
      business: { select: NEGOCIO_SELECT },
    },
  });

  const ok = user && user.activo && (await verifyPassword(password, user.passwordHash));

  // Mismo mensaje para email inexistente y password incorrecta: no revelamos
  // que cuentas estan registradas.
  if (!ok) {
    throw ApiError.unauthorized('Credenciales invalidas');
  }

  // Cada empresa tiene su propia puerta. Entrar por /b/otra-empresa con una
  // cuenta que no es de ahi no es un error de credenciales, es de empresa.
  if (slug && user.business?.slug !== slug) {
    throw ApiError.forbidden('Esta cuenta no pertenece a ese negocio');
  }

  if (user.business && !user.business.activo) {
    throw ApiError.forbidden('Este negocio esta desactivado');
  }

  const { passwordHash, business, ...datos } = user;
  const ultimoAcceso = new Date();

  await prisma.user.update({ where: { id: user.id }, data: { ultimoAcceso } });

  return sesion({ ...datos, ultimoAcceso }, business);
}

/**
 * Estado de la sesion. El frontend lo usa para pintar el nombre del usuario, el
 * rol y las cifras de la cuenta, y para decidir a que panel va.
 */
export async function me(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...USER_SELECT,
      business: { select: NEGOCIO_SELECT },
      client: { select: { id: true } },
    },
  });

  if (!user) {
    throw ApiError.notFound('Usuario no encontrado');
  }

  const { business, client, ...datos } = user;

  const citas = client
    ? await prisma.appointment.count({ where: { clientId: client.id } })
    : 0;

  return { user: USER_PUBLICO(datos), negocio: business, citas };
}

/**
 * Cierre de sesion. El JWT es sin estado, asi que por si solo no hay forma de
 * invalidarlo: subir `tokenVersion` lo deja sin efecto en la siguiente
 * peticion. Todos los tokens de ese usuario caen, no solo el que hizo la
 * llamada, que es justo lo que se espera de un cierre de sesion.
 */
export async function logout(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

/**
 * Cambio de contrasena. Sube tambien `tokenVersion`, asi que si alguien robo el
 * token, cambiar la clave lo deja fuera. La sesion de quien cambio la contrasena
 * tampoco sobrevive: tiene que volver a entrar con la nueva.
 */
export async function changePassword(userId, { passwordActual, passwordNueva }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user || !(await verifyPassword(passwordActual, user.passwordHash))) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'passwordActual', message: 'La contrasena actual no es correcta' },
    ]);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(passwordNueva),
      tokenVersion: { increment: 1 },
    },
  });

  // Se avisa de que la sesion queda cerrada: el frontend borra el token y
  // manda al login, en vez de descubrirlo en la siguiente peticion con un 401.
  return { mensaje: 'Contrasena actualizada. Vuelve a entrar con la nueva contrasena.' };
}