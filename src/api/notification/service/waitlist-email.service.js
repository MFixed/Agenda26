import { enviar } from '../../../../config/mailer.js';
import { env } from '../../../../config/env.js';
import { parseDateOnly, formatDateOnly } from '../../../utils/dates.js';
import { escapeHtml } from './escape.js';

/**
 * Aviso de "ya hay hueco" a quien estaba en la lista de espera (nuevo en v2).
 *
 * Es el correo con masroi de conversion de todo el sistema: la persona ya habia
 * dicho que queria, solo faltaba que hubiera sitio. Por eso lleva el enlace de
 * reserva pegado, y no buried en un pie.
 *
 * No va con .ics: todavia no hay cita reservada, asi que no hay evento que
 * descargar. Solo el aviso y el enlace.
 */

const FECHA_LARGA = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/**
 * Aviso de "ya hay hueco" a quien estaba en lista de espera.
 *
 * `hueco.date` es una fecha de calendario y se imprime tal cual, sin cambiar de
 * zona: aplicarle la del negocio haria que en Montevideo un lunes apareciera como
 * domingo. El horario va como texto, que ya es hora local.
 */
export async function avisarListaEspera(entrada, hueco) {
  const nombre = entrada.client?.nombre ?? '';
  const correo = entrada.client?.user?.email;
  const fecha = FECHA_LARGA.format(parseDateOnly(formatDateOnly(hueco.date)));
  const horario = `${hueco.startTime} a ${hueco.endTime}`;
  const enlace = `${env.appUrl}/cliente/citas?reservar=${hueco.id}`;

  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f4f6fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e7f0;border-radius:14px;overflow:hidden;">
          <tr><td style="background:#1d4ed8;padding:26px 28px;">
            <p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;opacity:.85;">Agenda26</p>
            <h1 style="margin:0;font-size:21px;line-height:1.3;color:#ffffff;font-weight:700;">Ya hay horario disponible</h1>
          </td></tr>
          <tr><td style="padding:26px 28px 8px;">
            <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#16202f;">Hola${nombre ? `, ${escapeHtml(nombre)}` : ''},</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d4a5f;">
              se ha liberado un horario que habias pedido esperar. Va primero en, quieto hasta que alguien lo reserve.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
              <tr><td style="border-radius:10px;background:#1d4ed8;">
                <a href="${enlace}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Reservar ahora</a>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border-top:1px solid #e0e7f0;">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e0e7f0;color:#6b7787;font-size:14px;width:38%;">Fecha</td>
                <td style="padding:10px 0;border-bottom:1px solid #e0e7f0;color:#16202f;font-size:14px;font-weight:600;">${escapeHtml(fecha)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e0e7f0;color:#6b7787;font-size:14px;">Horario</td>
                <td style="padding:10px 0;border-bottom:1px solid #e0e7f0;color:#16202f;font-size:14px;font-weight:600;">${escapeHtml(horario)}</td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:16px 28px 26px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7787;">
              Este aviso se manda una sola vez y el horario queda disponible para cualquiera que lo coja antes que tu.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const texto = [
    `Hola${nombre ? ` ${nombre}` : ''},`,
    '',
    'se ha liberado un horario que habias pedido esperar.',
    `Fecha: ${fecha}`,
    `Horario: ${horario}`,
    '',
    `Reservalo aqui: ${enlace}`,
    '',
    'El horario queda disponible para cualquiera que lo coja antes que tu.',
  ].join('\n');

  return enviar({ para: correo, asunto: 'Ya hay horario disponible', html, texto, etiqueta: 'lista-espera' });
}

export default { avisarListaEspera };
