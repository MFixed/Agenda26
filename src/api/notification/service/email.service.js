import { enviar } from '../../../../config/mailer.js';
import { env } from '../../../../config/env.js';
import { parseDateOnly, formatDateOnly } from '../../../utils/dates.js';

/**
 * Correo de aviso al cliente. Va aparte de la notificacion interna de la base de
 * datos: la interna vive en la campana del panel y esta se va por correo.
 *
 * El canal es el mismo (una cita cambia de estado) pero el destinatario y el soporte
 * no.
 *
 * v2 anade el aviso de cancelacion, que faltaba: el cliente se enteraba de que su
 * cita se habia caído por el correo de respuesta de la empresa, dias despues.
 *
 * El envio nunca es parte de una transaccion ni de la respuesta de la API: si
 * Resend falla, se registra y la cita ya esta confirmada igual.
 */

/// Identificador de producto de los .ics que genera este servicio.
const PRODID = '-//Agenda26//Citas//ES';

/**
 * 'martes, 20 de octubre de 2026'. Se formatea con zona UTC porque el dia de la
 * agenda se guarda a medianoche UTC: formatearlo en la zona del servidor lo
 * adelantaria un dia en America.
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
 * Los valores de texto de un .ics escapan estos caracteres (RFC 5545), no los del
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
 * Una linea de .ics no puede pasar de 75 octetos (RFC 5545): lo que exceda continua
 * en la linea siguiente empezando por un espacio.
 *
 * El corte va en un limite de caracter, nunca en medio de un UTF-8 multibyte (un
 * nombre con tilde o emoji se descuadra si se parte al byte). Las continuaciones van
 * con 74 utiles porque el espacio inicial ya cuenta.
 *
 * Un escape partido no es problema: el lector primero despliega y despues
 * interpreta los escapes, asi que la `\` y su `;` vuelven a estar juntos.
 */
function plegar(linea) {
  if (Buffer.byteLength(linea, 'utf8') <= 75) return linea;

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
 * Las horas van como hora local sin zona (DTSTART;20261020T090000) porque el modelo
 * guarda el dia y la franja del negocio, no un instante con zona: el horario es "el
 * 20/10 a las 09:00", y un DTSTART con Z lo convertiria a otra hora al abrirlo el
 * cliente. Es lo que espera el calendario de una tienda.
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
    /// PUBLISH y no REQUEST: esto es "guarda este evento en tu calendario", no una
    /// invitacion. Con REQUEST, Google Calendar y Outlook intentan mandar un acuse
    /// al organizador y aqui no hay ninguno al que responderle.
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

  /// El RFC pide CRLF: con saltos sueltos algunos calendarios ignoran el evento.
  return `${lineas.map(plegar).join('\r\n')}\r\n`;
}

/**
 * Maquetacion del correo. `saludo`, `parrafos` y `pie` entran como HTML ya hecho y
 * `detalle` como texto que se escapa aqui; quien llame tiene que escapar lo suyo
 * antes de meterlo en un fragmento.
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
    .map(
      (parrafo) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d4a5f;">${parrafo}</p>`
    )
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
 * La fecha se imprime tal cual, sin cambiar de zona.
 *
 * `availability.date` es una FECHA DE CALENDARIO: un dia sin hora, guardada a
 * medianoche UTC a proposito. Aplicarle la zona del negocio seria un error, no una
 * mejora: en Montevideo (UTC-3) una cita del martes pasaria a imprimirse como
 * lunes, porque medianoche UTC es las 21:00 del lunes en la ciudad.
 *
 * Por eso las funciones de correo reciben `{ timezone }` y no lo usan. El horario
 * se manda como texto ("14:00 a 15:00"), que ya es la hora local del cliente, y la
 * fecha va sin turno. El parametro se deja porque los llamantes lo pasan y
 * quitarlo exigiria tocar todos los `avisar*`.
 */
function fechaLargaDe(availability) {
  return FECHA_LARGA.format(parseDateOnly(formatDateOnly(availability.date)));
}

/**
 * Aviso de cita coordinada. Se manda con el archivo de calendario adjunto: el texto
 * llega al correo y el evento al calendario del cliente.
 */
function correoCitaCoordinada({ cita }) {
  const { task, client, availability, business } = cita;
  const nombre = client.nombre;
  const fecha = fechaLargaDe(availability);
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
 * Aviso de cita cancelada o rechazada (nuevo en v2).
 *
 * Sin el motivo no sirve de nada, asi que va siempre. Y sin el enlace a la agenda,
 * porque lo que el cliente quiere hacer en ese momento es volver a elegir otro
 * horario, no solidly: esa es la unica accion util y va en el pie.
 */
function correoCitaCancelada({ cita, cancelReason, cancelada }) {
  const { task, client, availability } = cita;
  const nombre = client.nombre;
  const fecha = fechaLargaDe(availability);
  const horario = `${availability.startTime} a ${availability.endTime}`;

  const asunto = cancelada
    ? `Tu cita ha sido cancelada: ${task.title}`
    : `Tu cita no ha podido confirmarse: ${task.title}`;

  const motivo = cancelReason ?? 'Sin especificar';

  const html = plantillaHtml({
    encabezado: cancelada ? 'Cita cancelada' : 'Cita no confirmada',
    colorFondo: '#b42318',
    saludo: `Hola ${escaparHtml(nombre)},`,
    parrafos: [
      cancelada
        ? `Tu cita para <strong>${escaparHtml(task.title)}</strong> ha sido cancelada.`
        : `Tu cita para <strong>${escaparHtml(task.title)}</strong> no ha podido confirmarse.`,
      'Puedes volver a elegir otro horario cuando quieras.',
    ],
    detalle: [
      { clave: 'Servicio', valor: escaparHtml(task.title) },
      { clave: 'Era el', valor: escaparHtml(`${fecha}, ${horario}`) },
      { clave: 'Motivo', valor: escaparHtml(motivo) },
    ],
    pie: `<a href="${env.appUrl}/cliente/citas" style="color:#2563eb;font-weight:600;">Elegir otro horario</a>`,
  });

  const texto = [
    `Hola ${nombre},`,
    '',
    cancelada
      ? `Tu cita para "${task.title}" ha sido cancelada.`
      : `Tu cita para "${task.title}" no ha podido confirmarse.`,
    '',
    `Era el ${fecha}, ${horario}`,
    `Motivo: ${motivo}`,
    '',
    `Puedes elegir otro horario aqui: ${env.appUrl}/cliente/citas`,
  ].join('\n');

  return { para: client.email, asunto, html, texto };
}

export async function avisarCitaCoordinada(cita) {
  return enviar({ ...correoCitaCoordinada({ cita }), etiqueta: 'cita-coordinada' });
}

export async function avisarCitaCancelada(cita) {
  return enviar({
    ...correoCitaCancelada({ cita, cancelReason: cita.cancelReason, cancelada: cita.status === 'CANCELLED' }),
    etiqueta: 'cita-cancelada',
  });
}

/**
 * Recordatorio previo a la cita (nuevo en v2).
 *
 * No lleva .ics: la cita ya esta confirmada y el cliente recibio el calendario
 * entonces. Aqui solo hace falta un aviso corto con la fecha, porque lo que hay que
 * recordar es "que viene manana" o "es en una hora", no volver a confirmar los datos.
 *
 * Si no hay correo configurado, `enviar` devuelve `{ enviado: false }` y quien
 * llama lo registra como fallido. Es lo honesto: el aviso no se pudo entregar y que
 * conste asi evita pensar que la gente lo recibio.
 */
export async function avisarRecordatorio(cita) {
  const { task, client, availability, business } = cita;
  const fecha = fechaLargaDe(availability);
  const horario = `${availability.startTime} a ${availability.endTime}`;

  const asunto = `Recordatorio: ${task.title} ${fecha}`;

  const html = plantillaHtml({
    encabezado: 'Recordatorio de cita',
    colorFondo: '#1d4ed8',
    saludo: `Hola${client.nombre ? `, ${escaparHtml(client.nombre)}` : ''},`,
    parrafos: [
      'Este es un recordatorio de la cita que tienes confirmada.',
      `Puedes gestionarla o moverla desde tu panel: <a href="${env.appUrl}/cliente/citas" style="color:#2563eb;">ver mis citas</a>.`,
    ],
    detalle: [
      { clave: 'Servicio', valor: escaparHtml(task.title) },
      { clave: 'Cuando', valor: escaparHtml(`${fecha}, ${horario}`) },
      { clave: 'Donde', valor: escaparHtml(business?.nombre ?? '') },
    ],
    pie: 'Si necesitas cambiar algo, hazlo cuanto antes: algunos horarios se agotan.',
  });

  const texto = [
    'Hola,',
    '',
    'Este es un recordatorio de la cita que tienes confirmada.',
    '',
    `Servicio: ${task.title}`,
    `Cuando: ${fecha}, ${horario}`,
    `Donde: ${business?.nombre ?? ''}`,
    '',
    `Ver mis citas: ${env.appUrl}/cliente/citas`,
  ].join('\n');

  return enviar({ para: client.user?.email, asunto, html, texto, etiqueta: 'recordatorio' });
}

export default { avisarCitaCoordinada, avisarCitaCancelada, avisarRecordatorio };
