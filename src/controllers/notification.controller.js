import { notificacionPublica } from "../utils/serialize.js";
import * as notificationService from "../services/notification.service.js";

/** GET /api/notifications — siempre las del usuario de la sesión. */
export async function listar(request, response) {
  const { items, noLeidas } = await notificationService.listarNotificaciones(request.user.id, {
    limit: Math.min(Number.parseInt(request.query.limit, 10) || 50, 200)
  });

  response.json({
    noLeidas,
    items: items.map((notificacion) => ({
      ...notificacionPublica(notificacion),
      cita: notificacion.appointment
        ? {
            id: notificacion.appointment.id,
            status: notificacion.appointment.status,
            fecha: notificacion.appointment.availability?.date
              ? notificacion.appointment.availability.date.toISOString().slice(0, 10)
              : null,
            hora: notificacion.appointment.availability?.startTime ?? null
          }
        : null
    }))
  });
}

/** PUT /api/notifications/:id/read */
export async function marcarLeida(request, response) {
  const notificacion = await notificationService.marcarLeida(request.user.id, request.id);
  response.json({ notificacion: notificacionPublica(notificacion), mensaje: "Notificación leída." });
}

/** PUT /api/notifications/read-all */
export async function marcarTodas(request, response) {
  const { actualizadas } = await notificationService.marcarTodasLeidas(request.user.id);
  response.json({ actualizadas, mensaje: "Notificaciones marcadas como leídas." });
}
