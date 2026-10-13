import { enviar } from '../../../../config/mailer.js';

/**
 * Correo de recuperacion de contrasena.
 *
 * Aparte del resto porque es el unico sitio donde un mensaje se manda SIN haber
 * autenticado a nadie: no hay cita, ni negocio, ni historial del que tirar. Solo
 * un nombre y un enlace con el token.
 *
 * El token va en la query y no en el cuerpo del HTML a proposito: muchos clientes
 * de correo quitan lo que parece un enlace activo cuando el texto lleva el token
 * dentro, y el enlace se queda a medias.
 */

const PROLOGO = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f4f6fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e7f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#b42318;padding:26px 28px;">
                <p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;opacity:.85;">Agenda26</p>
                <h1 style="margin:0;font-size:21px;line-height:1.3;color:#ffffff;font-weight:700;">Restablece tu contrasena</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 8px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#16202f;">Hola,</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d4a5f;">Alguien pidio restablecer la contrasena de tu cuenta. Si fuiste tu, usa el boton:</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                  <tr><td style="border-radius:10px;background:#b42318;">
                    <a href="__ENLACE__" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Restablecer contrasena</a>
                  </td></tr>
                </table>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#6b7787;">Si el boton no funciona, copia esta direccion en el navegador:</p>
                <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#16202f;word-break:break-all;">__ENLACE__</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 26px;border-top:1px solid #e0e7f0;">
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#6b7787;">
                  Si no has pedido esto, no hagas nada: tu contrasena no cambia y esta sesion sigue siendo la unica que hay.
                </p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7787;">
                  El enlace caduca en __MINUTOS__ minutos y solo se puede usar una vez.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export function correoRecuperacion({ user, enlace, minutos = 30 }) {
  const html = PROLOGO.replaceAll('__ENLACE__', enlace).replaceAll('__MINUTOS__', String(minutos));

  const texto = [
    'Hola,',
    '',
    'Alguien pidio restablecer la contrasena de tu cuenta. Si fuiste tu, entra aqui:',
    enlace,
    '',
    'Si no has pedido esto, no hagas nada: tu contrasena no cambia.',
    '',
    `El enlace caduca en ${minutos} minutos y solo se puede usar una vez.`,
  ].join('\n');

  return enviar({
    para: user.email,
    asunto: 'Restablece tu contrasena de Agenda26',
    html,
    texto,
    etiqueta: 'recuperacion',
  });
}

export default { correoRecuperacion };
