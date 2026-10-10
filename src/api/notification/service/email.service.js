import { resend, correoHabilitado } from '../../../../config/mailer.js';
import { env } from '../../../../config/env.js';
import { parseDateOnly } from '../../../utils/dates.js';

/**
 * Correo de aviso al cliente. Va aparte de la notificacion interna de la base
 * de datos: la interna vive en la campana del panel y esta se va por correo.
 * El canal es el mismo (una cita cambia de estado) pero el destinatario y el
 * soporte no.
 *
 * El envio nunca es parte de una transaccion ni de la respuesta de la API: si
 * Resend falla, se registra y la cita ya esta confirmada igual.
 */

/** Identificador de producto de los .ics que genera este servicio. */
const PRODID = '-//Agenda26//Citas//ES';

/**
 * 'martes, 20 de octubre de 2026'. Se formatea con zona UTC porque el dia de
 * la agenda se guarda a medianoche UTC: formatearlo en la zona del servidor
 * lo adelantaria un dia en America.
 */
const FECHA_LARGA = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** El texto que se cuela en el HTML viene del cliente: hay que escaparlo. */
function escaparHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Los valores de texto de un .ics escapan estos caracteres (RFC 5545), no el
 * HTML: van dentro del archivo, no dentro del correo.
 */
function escaparIcs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** '2026-10-20' + '09:00' -> '20261020T090000' (hora local, sin zona). */
function icsFecha(dia, hora) {
  return `${String(dia).replace(/-/g, '')}T${String(hora).replace(':', '')}00`;
}

/** '2026-10-20T16:38:12.480Z' -> '20261020T163812Z'. */
function icsSello(instante) {
  return `${instante.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/**
 * Una linea de .ics no puede pasar de 75 octetos (RFC 5545): lo que exceda
 * continua en la linea siguiente empezando por un espacio.
 *
 * El corte va en un limite de caracter, nunca en medio de un UTF-8 multibyte
 * (un nombre con tilde o emoji se descuadra si se parte al byte). Las
 * continuaciones van con 74 utiles porque el espacio inicial ya cuenta.
 *
 * Un escape partido no es problema: el lector primero despliega y despues
 * interpreta los escapes, asi que la `\` y su `;` vuelven a estar juntos.
 */
function plegar(linea) {
  if (Buffer.byteLength(linea, 'utf8') <= 75) {
    return linea;
  }

  const trozos = [];
  let actual = '';

  for (const caracter of linea) {
    if (Buffer.byteLength(actual + caracter, 'utf8') > (trozos.length === 0 ? 75 : 74)) {
      trozos.push(actual);
      actual = caracter;
    } else {
      actual += caracter;
    }
  }

  trozos.push(actual);

  return trozos.map((trozo, i) => (i === 0 ? trozo : ` ${trozo}`)).join('\r\n');
}

/**
 * El .ics que el cliente abre para que la cita caiga en su calendario.
 *
 * Las horas van como hora local sin zona (DTSTART;20261020T090000) porque el
 * modelo guarda el dia y la franja del negocio, no un instante con zona: el
 * horario es "el 20/10 a las 09:00", y un DTSTART con Z lo convertiria a otra
 * hora al abrirlo el cliente. Es lo que espera el calendario de una tienda.
 *
 * El UID sale del id de la cita, no de la fecha: si la cita se reprograma, el
 * cliente ve un evento actualizado en vez de duplicado.
 */
function calendarioIcs({ cita, negocio, descripcion }) {
  const { date: dia, startTime, endTime } = cita.availability;

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    // PUBLISH y no REQUEST: esto es "guarda este evento en tu calendario", no
    // una invitacion. Con REQUEST, Google Calendar y Outlook intentan mandar
    // un acuse al organizador y aqui no hay ninguno al que responderle.
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:cita-${cita.id}@agenda26.app`,
    `DTSTAMP:${icsSello(new Date())}`,
    `DTSTART:${icsFecha(dia, startTime)}`,
    `DTEND:${icsFecha(dia, endTime)}`,
    `SUMMARY:${escaparIcs(`Cita: ${cita.task.title} - ${negocio}`)}`,
    `DESCRIPTION:${escaparIcs(descripcion)}`,
    `LOCATION:${escaparIcs(negocio)}`,
    `URL:${escaparIcs(`${env.appUrl}/cliente/citas`)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // El RFC pide CRLF: con saltos sueltos algunos calendarios ignoran el evento.
  return `${lineas.map(plegar).join('\r\n')}\r\n`;
}

/**
 * Maquetacion del correo. `saludo`, `parrafos` y `pie` entran como HTML ya
 * hecho y `detalle` como texto que se escapa aqui; quien llame tiene que
 * escapar lo suyo antes de meterlo en un fragmento.
 */
function plantillaHtml({ encabezado, colorFondo, saludo, parrafos, detalle, pie }) {
  const celdas = detalle
    .map(
      (fila) => `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e0e7f0;color:#6b7787;font-size:14px;width:38%;">${fila.clave}</td>
              <td style="padding:10px 0;border-bottom:1px solid #e0e7f0;color:#16202f;font-size:14px;font-weight:600;">${fila.valor}</td>
            </tr>`
    )
    .join('');

  const cuerpo = parrafos
    .map((parrafo) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d4a5f;">${parrafo}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f4f6fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e7f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:${colorFondo};padding:26px 28px;">
                <p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;opacity:.85;">Agenda26</p>
                <h1 style="margin:0;font-size:21px;line-height:1.3;color:#ffffff;font-weight:700;">${encabezado}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 8px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#16202f;">${saludo}</p>
                ${cuerpo}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border-top:1px solid #e0e7f0;">
                  ${celdas}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 26px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7787;">${pie}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Aviso de cita coordinada. Se manda con el archivo de calendario adjunto: el
 * texto llega al correo y el evento al calendario del cliente.
 */
function correoCitaCoordinada({ cita }) {
  const { task, client, availability, business } = cita;
  const nombre = client.nombre;
  const fecha = FECHA_LARGA.format(parseDateOnly(availability.date));
  const horario = `${availability.startTime} a ${availability.endTime}`;

  const asunto = `Tu cita esta confirmada: ${task.title}`;

  const descripcion = [
    `Servicio: ${task.title}`,
    `Fecha: ${fecha}`,
    `Horario: ${horario}`,
    `Lugar: ${business.nombre}`,
    cita.note ? `Nota: ${cita.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const html = plantillaHtml({
    encabezado: 'Cita confirmada',
    colorFondo: '#10795a',
    saludo: `Hola ${escaparHtml(nombre)},`,
    parrafos: [
      `Tu cita para <strong>${escaparHtml(task.title)}</strong> ya quedo confirmada y agendada.`,
      'Te adjuntamos el archivo de calendario para que la agregues a tu agenda con un clic.',
    ],
    detalle: [
      { clave: 'Servicio', valor: escaparHtml(task.title) },
      { clave: 'Fecha', valor: escaparHtml(fecha) },
      { clave: 'Horario', valor: escaparHtml(horario) },
      { clave: 'Lugar', valor: escaparHtml(business.nombre) },
    ],
    pie: `Si necesitas moverla o cancelarla, responde a este correo o escribele a ${escaparHtml(business.nombre)} desde tu panel.`,
  });

  const texto = [
    `Hola ${nombre},`,
    '',
    `Tu cita para "${task.title}" ya quedo confirmada y agendada.`,
    '',
    `Servicio: ${task.title}`,
    `Fecha: ${fecha}`,
    `Horario: ${horario}`,
    `Lugar: ${business.nombre}`,
    cita.note ? `Nota: ${cita.note}` : null,
    '',
    'Te adjuntamos el archivo de calendario para que la agregues a tu agenda.',
    'Si necesitas moverla o cancelarla, responde a este correo.',
  ]
    .filter((linea) => linea !== null)
    .join('\n');

  return {
    para: client.email,
    asunto,
    html,
    texto,
    adjuntos: [
      {
        filename: `cita-${cita.id}.ics`,
        content: calendarioIcs({ cita, negocio: business.nombre, descripcion }),
      },
    ],
  };
}

/**
 * Manda un correo y nunca lanza. Devuelve que paso en lugar de reventar: quien
 * llama esta avisando de un cambio de estado ya guardado, y que Resend este
 * caido no puede deshacer la cita.
 */
export async function enviar({ para, asunto, html, texto, adjuntos = [] }) {
  if (!correoHabilitado) {
    return { enviado: false, motivo: 'correo no configurado (falta RESEND_API_KEY)' };
  }

  if (!para) {
    return { enviado: false, motivo: 'el cliente no tiene correo' };
  }

  // En desarrollo el correo puede acabarpareciendo en otra bandeja: el
  // remitente de prueba de Resend solo acepta la direccion del titular de la
  // cuenta. Se avisa por consola para que no sea un envio fantasma.
  const destino = env.emailTestDestino || para;

  if (env.emailTestDestino && env.emailTestDestino !== para) {
    console.log(`[correo] EMAIL_TEST_DESTINO activo: "${asunto}" va a ${destino} (el cliente ${para} no lo recibe)`);
  }

  try {
    const { data, error } = await resend.emails.send({
      from: env.emailFrom,
      to: [destino],
      subject: asunto,
      html,
      text: texto,
      attachments: adjuntos,
    });

    if (error) {
      console.error(`[correo] no se pudo enviar "${asunto}" a ${destino}:`, error.message);
      return { enviado: false, motivo: error.message };
    }

    return { enviado: true, id: data?.id ?? null };
  } catch (error) {
    console.error(`[correo] fallo inesperado enviando "${asunto}" a ${destino}:`, error.message);
    return { enviado: false, motivo: error.message };
  }
}

/**
 * Aviso de que la cita quedo coordinada. Es lo unico que hay aqui a proposito:
 * es el estado que el cliente espera en su correo.
 */
export async function avisarCitaCoordinada(cita) {
  return enviar(correoCitaCoordinada({ cita }));
}