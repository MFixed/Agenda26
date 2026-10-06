import { prisma } from "../config/database.js";
import { noEncontrado } from "../utils/http.js";

/**
 * Notificaciones internas. El campo `channel` ya está en el esquema para que
 * añadir email o WhatsApp más adelante sea escribir otro método que llame a
 * este, sin tocar la tabla ni los servicios que la usan.
 */
export async function listarNotificaciones(userId, { limit = 50 } = {}) {
  const [items, noLeidas] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        appointment: {
          select: {
            id: true,
            status: true,
            availability: { select: { date: true, startTime: true } }
          }
        }
      }
    }),
    prisma.notification.count({ where: { userId, readAt: null } })
  ]);

  return { items, noLeidas };
}

export async function marcarLeida(userId, id) {
  const notificacion = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notificacion) {
    throw noEncontrado("La notificación no existe.");
  }
  if (notificacion.readAt) {
    return notificacion;
  }
  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() }
  });
}

export async function marcarTodasLeidas(userId) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() }
  });
  return { actualizadas: count };
}

/**
 * Avisa a todos los administradores activos DE UN NEGOCIO. Se usa dentro de la
 * transacción de la cita, así que recibe el cliente de Prisma como `tx`.
 *
 * OJO con `businessId`: no es opcional aunque el tipo lo permita. En Prisma un
 * `undefined` dentro de `where` se traduce a "no filtrar por este campo", así que
 * forgettinglo no daría error: avisaría a los administradores de TODAS las
 * empresas. Como el aviso lleva el nombre del cliente y la hora de su cita, eso
 * es una fuga de datos entre negocios y no un fallo visible. Por eso se exige
 * aquí en lugar de confiar en que quien llama se acuerde.
 */
export async function avisarAdmins(tx, { appointmentId, type, title, message, businessId }) {
  if (!Number.isInteger(businessId)) {
    throw new Error(
      "avisarAdmins necesita un businessId: sin él el aviso se enviaría a los administradores de todas las empresas."
    );
  }

  const admins = await tx.user.findMany({
    where: { role: "ADMIN", activo: true, businessId },
    select: { id: true }
  });
  if (admins.length === 0) {
    return 0;
  }
  const { count } = await tx.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      appointmentId,
      type,
      title,
      message,
      channel: "INTERNAL"
    }))
  });
  return count;
}

/** Aviso a un destinatario concreto, también dentro de una transacción. */
export function crearNotificacion(tx, { userId, appointmentId = null, type, title, message }) {
  return tx.notification.create({
    data: { userId, appointmentId, type, title, message, channel: "INTERNAL" }
  });
}
