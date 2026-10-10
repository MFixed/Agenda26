import { Resend } from 'resend';
import { env } from './env.js';

/**
 * Unica instancia del cliente de correo, por el mismo motivo que en
 * `driver.js`: Express recarga los modulos en modo watch y un cliente por
 * recarga multiplicaria las conexiones.
 *
 * Sin RESEND_API_KEY no se construye nada y `resend` queda en null: la API
 * funciona igual, solo que los avisos no salen por correo. Lo que no puede
 * pasar es que falten variables obligatorias, asi que el remitente se valida
 * aqui y no en el sitio donde se manda el correo.
 */
const globalForMailer = globalThis;

if (!globalForMailer.resend && env.resendApiKey) {
  if (!env.emailFrom) {
    throw new Error('Falta EMAIL_FROM: el correo saliente necesita un remitente verificado en Resend.');
  }

  globalForMailer.resend = new Resend(env.resendApiKey);
}

export const resend = globalForMailer.resend ?? null;

/** Si hay a quien enviar. Lo consulta el servicio de correo antes de mollarse. */
export const correoHabilitado = resend !== null;