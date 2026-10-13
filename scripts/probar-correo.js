/**
 * Prueba el envio de correo con la configuracion del `.env`.
 *
 * Sirve para lo unico que no se puede comprobar de otra manera: que las credenciales
 * son correctas y que el servidor acepta el remitente. Todo lo demas de la app
 * funciona igual con el correo configurado o no; esto es una prova de fuego.
 *
 *   npm run email:probar
 *   npm run email:probar -- alguien@ejemplo.com     (si no pones destinatario, usa EMAIL_TEST_DESTINO)
 *
 * No imprime la contrasena ni la clave: solo si el envio fue bien o que fallo.
 */
import 'dotenv/config';
import { enviar, correoHabilitado } from '../config/mailer.js';
import { env } from '../config/env.js';

const destinatario = process.argv[2] || env.emailTestDestino;

process.stdout.write('\nProbando el envio de correo...\n\n');
process.stdout.write(`  transporte: ${env.mailDriver}\n`);
process.stdout.write(
  `  servidor:   ${env.smtpHost || '(API de Resend)'}${env.mailDriver === 'smtp' ? `:${env.smtpPort}` : ''}\n`
);
process.stdout.write(`  remitente:  ${env.emailFrom || '(sin definir)'}\n`);
process.stdout.write(`  destino:    ${destinatario || '(sin definir)'}\n\n`);

if (!correoHabilitado) {
  process.stderr.write('  ✗ El correo NO esta configurado.\n\n');
  process.stderr.write('    Revisa MAIL_DRIVER en el .env. Con Gmail:\n');
  process.stderr.write('      MAIL_DRIVER=smtp\n');
  process.stderr.write('      SMTP_HOST=smtp.gmail.com\n');
  process.stderr.write('      SMTP_PORT=587\n');
  process.stderr.write('      SMTP_SECURE=false\n');
  process.stderr.write('      SMTP_USER=tu-correo@gmail.com\n');
  process.stderr.write('      SMTP_PASS=la-contrasena-de-aplicacion\n\n');
  process.exit(1);
}

if (!destinatario) {
  process.stderr.write('  ✗ No hay ningun destinatario. Indica uno o pon EMAIL_TEST_DESTINO en el .env.\n\n');
  process.exit(1);
}

const resultado = await enviar({
  para: destinatario,
  asunto: 'Prueba de correo — Agenda26',
  texto: 'Este es un correo de prueba. Si lo lees, el envio funciona.',
  html: `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px">Envio de correo funcionando</h2>
      <p style="margin:0 0 12px">Este es un correo de prueba de Agenda26.</p>
      <p style="margin:0;color:#666">Si lo estas leyendo, las credenciales son correctas.</p>
    </div>`,
  etiqueta: 'prueba-manual',
});

process.stdout.write('\n');

if (resultado.enviado) {
  process.stdout.write(`  ✓ Enviado (id: ${resultado.id})\n\n`);
  /// El "verifica la carpeta de spam" no es superfluouso: un remitente personal
  /// sin DKIM llega a spam con mucha facilidad, y el que lo prueba por primera vez
  /// cree que no funciona cuando en realidad esta en la carpeta equivocada.
  process.stdout.write('  Revisa tambien la carpeta de spam: un remitente personal llega\n');
  process.stdout.write('  ahi con frecuencia, y no es que el envio haya fallado.\n\n');
  process.exit(0);
}

process.stderr.write(`  ✗ No se pudo enviar: ${resultado.motivo}\n\n`);
process.stderr.write('  Lo mas comun:\n');
process.stderr.write('   - "Invalid login" o "535": la contrasena de aplicacion esta mal, o\n');
process.stderr.write('     no hay verificacion en 2 pasos activada en la cuenta.\n');
process.stderr.write('   - "Must be a fully-qualified address": EMAIL_FROM sin nombre, del tipo\n');
process.stderr.write('     "Agenda26 <tu-correo@gmail.com>".\n');
process.stderr.write('   - "Connection timed out": el servidor no llega; en una red con cortafuegos\n');
process.stderr.write('     hay que permitir las conexiones salientes al puerto 587.\n\n');
process.exit(1);
