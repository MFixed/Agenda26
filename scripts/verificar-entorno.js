/**
 * Comprobacion del entorno ANTES de arrancar la API.
 *
 * Se ejecuta como `prestart`, de modo que un despliegue con la configuracion mal
 * puesta para en este script con un mensaje claro, en vez de arrancar "bien" y
 * fallar mas tarde en la primera peticion de un cliente.
 *
 * Solo AVISA de lo que no se puede comprobar de forma fiable sin tocar nada. Para
 * lo que se puede verificar de verdad (base conectada, esquema aplicado) esta
 * `verificarEsquema()` en `index.js`, que corre en el proceso real.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/// Los avisos van a stderr para que se vean igual haya o no log estructurado.
const avisar = (icono, texto) => process.stderr.write(`  ${icono} ${texto}\n`);
const problema = (texto) => avisar('✗', texto);
const aviso = (texto) => avisar('!', texto);
const bien = (texto) => avisar('·', texto);

/*
 * `dotenv` ya se cargo al importar `config/env.js`, que valida lo obligatorio y
 * lanza con un mensaje claro si falta algo. Aqui solo se avisa de lo que ha pasado
 * la validacion pero sigue siendo un problema en produccion.
 */
const { env } = await import('../config/env.js');

process.stderr.write(`\nComprobando el entorno (${env.env})...\n\n`);

if (!env.isProduction) {
  bien('Desarrollo: se saltan las comprobaciones de produccion.');
  process.stderr.write('\n');
  process.exit(0);
}

process.stderr.write('  Produccion:\n');

/* 1. NODE_ENV */
if (env.env === 'production') {
  bien('NODE_ENV=production');
}

/* 2. APP_URL debe ser una URL real y publica */
if (!/^https?:\/\//i.test(env.appUrl)) {
  problema(`APP_URL no es una URL: "${env.appUrl}"`);
} else if (env.appUrl.includes('localhost') || env.appUrl.includes('127.0.0.1')) {
  problema(
    `APP_URL apunta a localhost ("${env.appUrl}"). Los enlaces de correo y de .ics saldran inservibles.`
  );
} else if (!env.appUrl.startsWith('https://')) {
  aviso(`APP_URL no usa HTTPS ("${env.appUrl}").`);
} else {
  bien(`APP_URL=${env.appUrl}`);
}

/* 3. CORS: ya falla al arrancar si es `*`, pero se avisa del caso explicito */
if (env.corsOrigins.includes('*')) {
  problema('CORS_ORIGIN="*" permite llamadas desde cualquier origen.');
} else {
  bien(`CORS_ORIGIN=${env.corsOrigins.join(', ')}`);
}

/* 4. Swagger */
if (env.docsEnabled) {
  aviso('DOCS_ENABLED=true: /api/docs queda publico. Comprueba que es lo que quieres.');
} else {
  bien('DOCS_ENABLED=false (documentacion cerrada)');
}

/* 5. Rate limits: activos de verdad */
if (!env.rateLimitEnabled) {
  problema('RATE_LIMIT_ENABLED=false: no hay limite de peticiones.');
} else {
  bien(
    `Rate limits activos (general ${env.rateLimitMax}/${env.rateLimitWindowMs / 60000}min, ` +
      `login ${env.loginRateLimitMax}, registro ${env.registerRateLimitMax}, recuperación ${env.forgotRateLimitMax})`
  );
}

/* 6. Jobs: si hay mas de una instancia, solo una debe correrlos */
if (!env.jobsEnabled) {
  aviso('JOBS_ENABLED=false: nadie expira retenciones ni manda recordatorios en esta instancia.');
} else {
  bien('JOBS_ENABLED=true');
}

/* 7. Correo */
if (!env.resendApiKey) {
  aviso('RESEND_API_KEY vacio: no sale correo. Los avisos quedan solo como notificacion interna.');
} else if (!env.emailFrom) {
  problema('RESEND_API_KEY puesto pero EMAIL_FROM vacio: el envio fallara.');
} else {
  bien(`Correo configurado (${env.emailFrom})`);
}

/* 8. Secretos: que no sean los de ejemplo */
if (/^cambia|example|cambiar|placeholder|changeme/i.test(env.jwtSecret)) {
  problema('JWT_SECRET parece un valor de ejemplo. Hay que generar uno propio.');
}

/* 9. Trust proxy */
if (env.trustProxy) {
  aviso(
    `TRUST_PROXY=${env.trustProxy}: los limites usan la IP que manda el proxy. Asegurate de que es cierto.`
  );
} else {
  bien('TRUST_PROXY desactivado (los limites usan la IP real de la conexion)');
}

/* 10. Ruta de la base: que exista su carpeta */
const url = env.databaseUrl ?? '';
if (/^file:/i.test(url)) {
  const ruta = url.slice('file:'.length).split('?')[0].trim();
  const absoluta = isAbsolute(ruta) ? ruta : resolve(raiz, 'prisma', ruta);
  const carpeta = dirname(absoluta);

  if (!existsSync(carpeta)) {
    problema(`La carpeta de la base no existe: ${carpeta}. Creala antes de arrancar.`);
  } else if (!existsSync(absoluta)) {
    aviso(`La base aun no existe (${absoluta}). Ejecuta "npm run db:migrate" para crearla.`);
  } else {
    bien(`Base en ${absoluta}`);
  }
} else {
  bien(`Base de datos externa configurada`);
}

process.stderr.write('\n');
