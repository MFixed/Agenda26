import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET'];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Faltan variables de entorno: ${missing.join(', ')}. Revisa .env o copia .env.example.`
  );
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  databaseUrl: process.env.DATABASE_URL,
  isProduction: process.env.NODE_ENV === 'production',
  // El correo es opcional: sin clave la API arranca igual y los avisos se
  // quedan en la notificacion interna de la base, sin correo.
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  // Redireccion de correo para desarrollo. El remitente de prueba de Resend
  // (onboarding@resend.dev) solo deja enviar a la direccion con la que se creo
  // la cuenta: sin esto, coordinar una cita de prueba a otro cliente falla con
  // 403. Con esto el aviso llega a esta direccion y se puede ver el correo y
  // el .ics completos. En produccion la variable se ignora aunque este puesta:
  // ahi los avisos van a su destinatario real, siempre.
  emailTestDestino:
    process.env.NODE_ENV === 'production' ? '' : process.env.EMAIL_TEST_DESTINO || '',
  // Base publica de la aplicacion: el correo la usa para apuntar al panel del
  // cliente en vez de a un localhost que no le sirve de nada.
  appUrl: process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  // Orígenes que pueden llamar a la API desde un navegador, separados por
  // comas. Vacio significa "cualquiera": el frontend se sirve desde el mismo
  // Express, asi que CORS solo importa si el panel se abre desde otro host
  // (un Vite en desarrollo, un dominio aparte en produccion). Con
  // CORS_ORIGIN=* se acepta cualquier origen, que es lo unico comodo en
  // desarrollo y lo que no se debe dejar puesto en produccion.
  corsOrigins: (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean),
  // Formato del log de peticiones de morgan: dev (colorido, corto), combined
  // (el clasico de Apache) o none para apagarlo. En produccion, combined.
  logFormat: process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'combined' : 'dev'),
  // Documentacion interactiva (Swagger UI). Se puede apagar en produccion si
  // no se quiere exponer el mapa de la API.
  docsEnabled: process.env.DOCS_ENABLED !== 'false',
  // Limites de peticiones. Los tres estan en minutos de ventana.
  //
  // El limite de login viene generoso a proposito (15 por cada 15 minutos) y
  // cuenta SOLO los intentos fallidos: si contara tambien los exitos, un
  // usuario normal que entra y sale varias veces acabaria bloqueado, y el
  // limite dejaria de ser una proteccion para convertirse en una molestia.
  rateLimitWindowMs: (Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15) * 60 * 1000,
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 300,
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 15,
  // Con RATE_LIMIT_ENABLED=false se apagan todos los limites. Para las pruebas
  // automaticas, que hacen 181 peticiones seguidas contra la API real y no son
  // un trafico hostil sino una comprobacion.
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  // Content-Security-Policy. Se puede apagar si hay que servir recursos de otro
  // origen; el resto de cabeceras de helmet siguen puestas.
  cspEnabled: process.env.CSP_ENABLED !== 'false',
  // Cuantos proxies hay delante. Sin esto, `req.ip` es la maquina que habla con
  // Express y todas las peticiones comparten un mismo limite de peticiones.
  //
  // Ponerlo sin que sea verdad es peor que no ponerlo: un cliente podria
  // mandar su propia cabecera X-Forwarded-For y saltarse el limite falseando
  // esa IP. Por defecto no se activate en desarrollo y se activate en
  // produccion, que es donde se despliega detras de TLS.
  trustProxy:
    process.env.TRUST_PROXY !== undefined
      ? process.env.TRUST_PROXY === 'true'
        ? true
        : Number(process.env.TRUST_PROXY) || false
      : process.env.NODE_ENV === 'production',
};