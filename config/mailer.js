import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Cliente de correo.
 *
 * Hay DOS transportes y ambos tienen la misma interfaz, asi que el resto del
 * programa no sabe cual esta en uso:
 *
 *  - **resend**: una API HTTP. Es lo que se usa en produccion de verdad: no hay que
 *    mantener nada, no hay limite practico y los remitentes salen con DKIM y DMARC
 *    puestos de origen.
 *  - **smtp**: cualquier servidor de correo. Es lo que hace Gmail, Outlook,
 *    Brevo, Mailgun... Se usa cuando no hay otra cosa o cuando se quiere salir del
 *    servicio de pago.
 *
 * El que se usa lo dice `MAIL_DRIVER`, y se deduce solo: si hay clave de Resend,
 * Resend; si hay `SMTP_HOST`, SMTP; si no hay ninguna de las dos, no hay correo y
 * los avisos se quedan en la notificacion interna de la base.
 *
 * Lo que no puede pasar es una configuracion A MEDIAS: poner `MAIL_DRIVER=smtp` sin
 * `SMTP_HOST` no puede esperar al primer correo fallido para avisar. Se comprueba
 * al arrancar, que es cuando todavia no ha pasado nada.
 */

/* ---------------- Resend ---------------- */

const globalForMailer = globalThis;

if (!globalForMailer.resend && env.resendApiKey) {
  if (!env.emailFrom) {
    throw new Error('Falta EMAIL_FROM: el correo saliente necesita un remitente verificado en Resend.');
  }

  globalForMailer.resend = new Resend(env.resendApiKey);
}

export const resend = globalForMailer.resend ?? null;

/* ---------------- SMTP ---------------- */

/**
 * El transporte de SMTP, construido una vez.
 *
 * `pool: true` mantiene conexiones abiertas en lugar de abrir y cerrar una por cada
 * correo: sin eso, mandar veinte recordatorios seguidos abre veinte conexiones, y
 * Gmail las ve como veinte inicios de sesion Rare, que es justo uno de los motivos
 * por los que acaba bloqueando una cuenta.
 */
function construirSmtp() {
  if (!env.smtpHost) {
    throw new Error('MAIL_DRIVER=smtp pero falta SMTP_HOST.');
  }

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    /// `true` = TLS directo (el 465 de Gmail). `false` = STARTTLS (el 587), que
    /// empieza sin cifrar y sube a cifrado en el handshake.
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    /// Que no se quede esperando a un servidor que no contesta.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

if (env.mailDriver === 'smtp' && !globalForMailer.smtp) {
  if (!env.emailFrom) {
    throw new Error('Falta EMAIL_FROM: el correo saliente necesita un remitente.');
  }

  globalForMailer.smtp = construirSmtp();
}

export const smtp = globalForMailer.smtp ?? null;

export const correoHabilitado = env.mailDriver === 'resend' ? resend !== null : env.mailDriver === 'smtp';

/**
 * Huella de una direccion, para poder meterla en el log sin meter la direccion.
 *
 * Los logs van a un agregador que se acaba leyendo con mas gente de la que
 * deberia tener la lista de clientes de un negocio. Con el SHA-256 truncado se
 * puede seguir hablando de "el mismo destinatario" (cuantos correos se le
 * mandaron, si todos fallaron) sin escribir la direccion en ningun sitio.
 */
function huella(destino) {
  return destino ? createHash('sha256').update(String(destino)).digest('hex').slice(0, 12) : null;
}

/**
 * Envia un correo y nunca lanza.
 *
 * Devuelve que paso en vez de reventar. Quien llama esta avisando de un cambio de
 * estado ya guardado en la base: que el servidor de correo este caido no puede
 * deshacer la cita ni devolver un error a quien la coordino. Quejarse aqui y seguir
 * es justo lo que hace un buen gestor de errores.
 */
export async function enviar({ para, asunto, html, texto, adjuntos = [], etiqueta }) {
  if (!correoHabilitado) {
    return { enviado: false, motivo: 'correo no configurado (falta MAIL_DRIVER o RESEND_API_KEY/SMTP_HOST)' };
  }

  if (!para) {
    return { enviado: false, motivo: 'el destinatario no tiene correo' };
  }

  // En desarrollo el correo puede acabar en otra bandeja: se manda todo a una sola
  // direccion para poder verlo sin entregar nada a un cliente de verdad. En
  // produccion se ignora aunque este puesta (env.js la fuerza a vacio).
  const destino = env.emailTestDestino || para;

  if (env.emailTestDestino && env.emailTestDestino !== para) {
    logger.info('correo redirigido a EMAIL_TEST_DESTINO', {
      etiqueta,
      asunto,
      destino: huella(destino),
      real: huella(para),
    });
  }

  try {
    const resultado =
      env.mailDriver === 'smtp'
        ? await enviarPorSmtp({ destino, asunto, html, texto, adjuntos })
        : await enviarPorResend({ destino, asunto, html, texto, adjuntos });

    if (!resultado.enviado) {
      logger.error('no se pudo enviar el correo', {
        etiqueta,
        asunto,
        destinatario: huella(destino),
        transporte: env.mailDriver,
        motivo: resultado.motivo,
      });

      return resultado;
    }

    logger.info('correo enviado', {
      etiqueta,
      asunto,
      destinatario: huella(destino),
      transporte: env.mailDriver,
      id: resultado.id,
    });

    return resultado;
  } catch (error) {
    logger.error('fallo inesperado enviando el correo', {
      etiqueta,
      asunto,
      destinatario: huella(destino),
      transporte: env.mailDriver,
      motivo: error.message,
    });

    return { enviado: false, motivo: error.message };
  }
}

/** Envía por la API de Resend. */
async function enviarPorResend({ destino, asunto, html, texto, adjuntos }) {
  const { data, error } = await resend.emails.send({
    from: env.emailFrom,
    to: [destino],
    subject: asunto,
    html,
    text: texto,
    attachments: adjuntos,
  });

  if (error) {
    return { enviado: false, motivo: error.message };
  }

  return { enviado: true, id: data?.id ?? null };
}

/**
 * Envía por SMTP.
 *
 * El mensaje se construye a mano (`text` + `html` como alternativa) porque no todas
 * las vistas de correo de los clientes respetan la parte HTML: sin `text`, el correo
 * llega con las etiquetas dentro en Gmail.
 */
async function enviarPorSmtp({ destino, asunto, html, texto, adjuntos }) {
  const info = await smtp.sendMail({
    from: env.emailFrom,
    to: destino,
    subject: asunto,
    text: texto || undefined,
    html: html || undefined,
    attachments: adjuntos.length > 0 ? adjuntos : undefined,
  });

  return { enviado: true, id: info.messageId ?? null };
}

export default { resend, smtp, correoHabilitado, enviar };
