import 'dotenv/config';

/**
 * Variables de entorno de v2.
 *
 * Se separa en grupos segun quien lo lee, porque no es lo mismo una variable que
 * decide si la API arranca (y por tanto si el deploy es valido) que una que solo
 * cambia un comportamiento opcional. Las obligatorias se comprueban aqui; las
 * demas tienen valor por defecto sensato y la app arranca sin ellas.
 */

const obligatorias = ['DATABASE_URL', 'JWT_SECRET'];

const faltantes = obligatorias.filter((clave) => !process.env[clave]);

if (faltantes.length > 0) {
  throw new Error(`Faltan variables de entorno: ${faltantes.join(', ')}. Revisa .env o copia .env.example.`);
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
}

/**
 * Lee un booleano de entorno.
 *
 * Acepta todo lo que se le ocurre a quien escribe un `.env`: `true/false`, `1/0`,
 * `si/no`, `yes/no`, `on/off`. Antes solo reconocia la cadena exacta `"false"`, con
 * lo que `RATE_LIMIT_ENABLED=0` dejaba los limites puestos y `JOBS_ENABLED=0` los
 * dejaba corriendo: el operador creia haberlos apagado y no lo habia.
 */
const bool = (valor, porDefecto) => {
  if (valor === undefined || valor === null) return porDefecto;

  const v = String(valor).trim().toLowerCase();
  if (v === '') return porDefecto;

  if (['false', '0', 'no', 'off', 'n', 'disable', 'disabled'].includes(v)) return false;
  if (['true', '1', 'si', 'sí', 'yes', 'on', 'y', 'enable', 'enabled'].includes(v)) return true;

  /// Valor que no se entiende: se avisa en vez de adivinar. Adivinar `true` cuando
  /// alguien escribio `RATE_LIMIT_ENABLED=si` y se leyo `flase` es peor que nada.
  throw new Error(
    `Variable de entorno con valor booleano no valido: "${valor}". Usa true/false, 1/0, si/no, yes/no u on/off.`
  );
};

/**
 * Lee un entero de entorno.
 *
 * Un valor VACIO o no numerico devuelve el default. Antes no era asi: `Number('')`
 * es `0` y `Number.isFinite(0)` es `true`, asi que `PORT=` vacio daba puerto `0`, que
 * hace que el sistema elija un puerto aleatorio y que todos los enlaces de correo
 * salgan con `http://localhost:0`. Y `RATE_LIMIT_WINDOW_MINUTES=` daba `windowMs: 0`,
 * que `express-rate-limit` rechaza al importarse y tumba la API entera al arrancar.
 */
const int = (valor, porDefecto, { min = -Infinity, max = Infinity } = {}) => {
  if (valor === undefined || valor === null) return porDefecto;

  const texto = String(valor).trim();
  if (texto === '') return porDefecto;

  const n = Number(texto);
  if (!Number.isInteger(n)) {
    throw new Error(
      `Variable de entorno con valor entero no valido: "${valor}". Se esperaba un numero entero.`
    );
  }

  return Math.min(Math.max(n, min), max);
};

const lista = (valor, porDefecto) =>
  (valor || porDefecto)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';

/*
 * Que transporte de correo se usa.
 *
 * Se deduce solo (hay clave de Resend → Resend; hay SMTP_HOST → SMTP) pero se puede
 * forzar con `MAIL_DRIVER`. Se valida aqui y no en el envio: un valor mal escrito
 * tiene que parar el arranque, cuando todavia no ha pasado nada, y no aparecer a
 * mitad de una recuperacion de contrasena.
 */
const MAIL_DRIVER =
  process.env.MAIL_DRIVER ||
  (process.env.RESEND_API_KEY ? 'resend' : process.env.SMTP_HOST ? 'smtp' : 'ninguno');

const DRIVERS_VALIDOS = ['resend', 'smtp', 'ninguno'];

if (!DRIVERS_VALIDOS.includes(MAIL_DRIVER)) {
  throw new Error(`MAIL_DRIVER no valido: "${MAIL_DRIVER}". Usa ${DRIVERS_VALIDOS.join(', ')}.`);
}

/*
 * El puerto NO puede ser 0.
 *
 * `app.listen(0)` deja que el sistema elija un puerto efimero: el proceso arranca
 * "bien", dice `http://localhost:0` y todos los enlaces que salen de `APP_URL` (los
 * de recuperar contrasena, los .ics de las citas) salen con un puerto que no
 * existe. En un despliegue es una base de datos vacia y ninguna forma de entrar.
 */
const port = int(process.env.PORT, 3000, { min: 1, max: 65_535 });

export const env = {
  // --- Nucleo ---
  env: process.env.NODE_ENV || 'development',
  isProduction,
  isTest: process.env.NODE_ENV === 'test',
  port,
  databaseUrl: process.env.DATABASE_URL,

  /*
   * `APP_URL` es obligatoria en produccion.
   *
   * Es la base de los enlaces que salen por correo: recuperar contrasena, confirmar
   * cita, el .ics. Sin ella en produccion, esos enlaces se construyen con
   * `http://localhost:3000` y le llegan al cliente como enlaces que no abren en
   * ningun sitio. Es mejor que la app no arranque que arrancar con los correo
   * inservibles.
   */
  appUrl: (() => {
    const configurada = process.env.APP_URL?.trim();
    const porDefecto = `http://localhost:${port}`;

    if (!configurada && isProduction) {
      throw new Error(
        'Falta APP_URL en produccion: es la base de los enlaces de correo (recuperar contrasena, .ics).'
      );
    }

    return (configurada || porDefecto).replace(/\/+$/, '');
  })(),

  /// Margen para cerrar conexiones abiertas. Minimo 1s: por debajo, el cierre
  /// forzado se dispara antes de que servidor el pueda atender siquiera.
  shutdownTimeoutMs: int(process.env.SHUTDOWN_TIMEOUT_MS, 10_000, { min: 1_000 }),

  /**
   * Que motor hay detras.
   *
   * Se deduce de la propia `DATABASE_URL` en lugar de variable aparte: si alguien
   * cambia `DATABASE_URL` a un fichero SQLite y olvida cambiar el motor, el codigo
   * que depende de uno (los PRAGMAs) intentaria hablar SQL de PostgreSQL y el error
   * seria bastante menos claro que "estoy leyendo SQLite de la URL".
   */
  databaseProvider: /^\s*file:/i.test(process.env.DATABASE_URL) ? 'sqlite' : 'postgresql',

  // --- Autenticacion ---
  jwtSecret: process.env.JWT_SECRET,
  /// Access token corto. Se refresca con el refresh token sin que el usuario
  /// tenga que volver a escribir su contrasena.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtIssuer: process.env.JWT_ISSUER || 'agenda26',
  jwtAudience: process.env.JWT_AUDIENCE || 'agenda26-app',

  /// El refresh token vive bastante mas que el access token. Es lo que hace que
  /// un panel abierto toda la tarde no expulse a nadie a mitad de trabajo.
  ///
  /// Solo en DIAS. Antes existia tambien `REFRESH_EXPIRES_IN` ('30d'), que no lo
  /// leia nadie: ponerlo a 7 dias no cambiaba nada y el que lo creyera vigente
  /// tenia sesiones de 30 dias. Una variable de entorno que no hace nada es peor
  /// que no existir, porque ocupa el sitio de la que si funciona.
  refreshExpiresDays: int(process.env.REFRESH_EXPIRES_DAYS, 30, { min: 1, max: 365 }),

  passwordResetExpiresMin: int(process.env.PASSWORD_RESET_EXPIRES_MIN, 30, { min: 5, max: 1440 }),

  /*
   * --- Correo (opcional) ---
   *
   * Hay DOS formas de enviar correo y se elige UNA con `MAIL_DRIVER`.
   *
   * Sin ninguna de las dos, la API arranca igual: los avisos se quedan en la
   * notificacion interna de la base y no sale correo. Lo que no puede pasar es una
   * configuracion a medias que reviente al arrancar, asi que la combinacion imposible
   * se comprueba aqui y no en el momento de enviar, que es cuando ya hay un usuario
   * esperando su correo.
   */
  mailDriver: MAIL_DRIVER,

  // --- Resend (API HTTP) ---
  resendApiKey: process.env.RESEND_API_KEY || '',

  // --- SMTP (cualquier servidor: Gmail, Outlook, Brevo, Mailgun...) ---
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: int(process.env.SMTP_PORT, 587, { min: 1, max: 65_535 }),
  /// `true` para los puertos 465 (conexion cifrada directa). `false` para el 587, que
  /// empieza sin cifrar y sube a TLS con STARTTLS. Es lo que espera cada servidor.
  smtpSecure: bool(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  /// La "contrasena de aplicacion" de Gmail, NO la contrasena normal de la cuenta.
  /// Gmail no deja que un programa entre con la clave de verdad: hay que generar una
  /// clave de 16 caracteres en la seguridad de la cuenta.
  smtpPass: process.env.SMTP_PASS || '',

  emailFrom: process.env.EMAIL_FROM || '',
  emailTestDestino: isProduction ? '' : process.env.EMAIL_TEST_DESTINO || '',

  // --- Red y cabeceras ---
  corsOrigins: lista(process.env.CORS_ORIGIN, '*'),

  /*
   * El formato del log lo decide el entorno, no una variable.
   *
   * Existia `LOG_FORMAT` ('dev'/'combined') pero nadie lo leia: `logger.js` decide
   * con `env.isProduction`. Estaba en `.env.example` como sisef ectuara, y quien
   * quisiera JSON en desarrollo no lo conseguia. La decision real es "produccion o
   * no", asi que la variable se elimina en lugar de fingir que hace algo.
   */
  logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

  /// Cuantos proxies hay delante. Puesto sin que sea verdad es PEOR que no
  /// ponerlo: un cliente podria mandar su X-Forwarded-For y saltarse el limite.
  ///
  /// El valor por defecto en PRODUCCION es `false`, no `true`.
  ///
  /// Con `trust proxy = true`, Express toma `req.ip` de la cabecera
  /// `X-Forwarded-For` que envie el cliente. Un atacante que mande un XFF distinto
  /// en cada peticion recibe un cubo de limite NUEVO en cada una: los limites de
  /// login, recuperacion y registro dejan de existir sin tocar una linea de codigo.
  ///
  /// Por eso NO se adivina. Si hay un proxy delante hay que decirlo con
  /// `TRUST_PROXY=1` (o el numero de saltos); si no lo hay, `false` es lo correcto y
  /// lo unico seguro. Aqui se paga con el limite entero, asi que el default es el
  /// seguro y la activacion es una decision consciente.
  trustProxy:
    process.env.TRUST_PROXY !== undefined
      ? process.env.TRUST_PROXY === 'true'
        ? true
        : int(process.env.TRUST_PROXY, 0) || false
      : false,

  // --- Limites de peticiones ---
  //
  // Todos con minimo 1. Un 0 aqui no significa "sin limite": `windowMs: 0` hace que
  // `express-rate-limit` lance al importarse (tumbando la API al arrancar) y
  // `limit: 0` significa que TODA peticion recibe un 429, con lo que el servicio
  // parece_caerido sin llegar a dar un error. Para desactivar un limite esta
  // `RATE_LIMIT_ENABLED=false`, que apaga el bloque entero.
  rateLimitEnabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MINUTES, 15, { min: 1 }) * 60 * 1000,
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 300, { min: 1 }),
  loginRateLimitMax: int(process.env.LOGIN_RATE_LIMIT_MAX, 15, { min: 1 }),
  /// Recuperar contrasena es la puerta que mas atrae a un atacante: genera un
  /// correo por peticion. Tiene su propio limite, mas bajo que el del login.
  forgotRateLimitMax: int(process.env.FORGOT_RATE_LIMIT_MAX, 5, { min: 1 }),
  /// Alta de cuentas. Va por IP y cuenta TODAS las peticiones (incluidas las que
  /// salen bien): el limite del login no sirve aqui, porque su clave incluye el
  /// email y un atacante con cuentas distintas se saltaria el contador entero.
  registerRateLimitMax: int(process.env.REGISTER_RATE_LIMIT_MAX, 10, { min: 1 }),

  /*
   * Swagger UI: APAGADO en produccion salvo que se pida de forma explicita.
   *
   * `/api/docs` no pide autenticacion y ademas esta exento del rate limit, asi que
   * por defecto es la puerta por la que se lee el contrato completo de la API y se
   * generan tokens. Publicar eso en un despliegue real es filtrar el mapa de la
   * aplicacion a cualquiera que pase por ahi.
   *
   * En desarrollo se deja encendido, que es cuando hace falta.
   */
  docsEnabled: isProduction ? bool(process.env.DOCS_ENABLED, false) : bool(process.env.DOCS_ENABLED, true),

  // --- CSP ---
  cspEnabled: bool(process.env.CSP_ENABLED, true),

  // --- Jobs en segundo plano ---
  jobsEnabled: bool(process.env.JOBS_ENABLED, true),
  /// Cada cuanto despierta el planificador. En pruebas se apaga: los tests no
  /// necesitan que un worker concurrence con ellos. Minimo 1000 ms: por debajo, el
  /// worker se solapa consigo mismo y la base se bloquea.
  jobIntervalMs: int(process.env.JOB_INTERVAL_MS, 60_000, { min: 1_000 }),
  /// Cuanto se retienen los huecos por el cliente antes de soltarse.
  holdMinutes: int(process.env.HOLD_MINUTES, 10, { min: 1, max: 120 }),
  /// Dias que se guardan las notificaciones leidas antes de purgarlas.
  notificationRetentionDays: int(process.env.NOTIFICATION_RETENTION_DAYS, 90, { min: 1 }),

  // --- Correo saliente de recordatorios ---
  remindersEnabled: bool(process.env.REMINDERS_ENABLED, true),
};

export default env;
