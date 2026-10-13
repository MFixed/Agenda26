import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../../config/env.js';

/**
 * Limite de peticiones.
 *
 * Es una decision consciente: el contador vive en un `Map` del propio proceso.
 * Con una sola instancia es exactamente igual de eficaz que Redis y no obliga a
 * levantar un servicio mas. Con varias instancias, cada una lleva su cuenta y el
 * tope real es `limite x instancias`, asi que hay que bajar el limite al repartir.
 * El cambio a un almacen compartido se queda en este archivo.
 *
 * v2 anade un limitador para "olvide mi contrasena". Es la puerta que mas atrae:
 * cada peticion genera un correo real y, sin tope, cualquiera puede usar la app
 * como un generador de spam con el dominio de la empresa.
 */

/**
 * El error del limite sale con la misma forma que el resto de la API
 * (`{ error, details }`) en vez del texto plano que pone la libreria por
 * defecto, para que el frontend no tenga un segundo formato que aprender.
 */
const respondeApi = (mensaje) => (req, res) => {
  const retryAfter = Number(res.getHeader('Retry-After')) || 60;

  res.status(429).json({
    error: mensaje,
    details: [
      {
        field: 'rate',
        message: `Espera un momento antes de volver a intentarlo (${Math.ceil(retryAfter)} s).`,
      },
    ],
    requestId: req.id,
  });
};

/// Las peticiones que se responden siempre: sin ellas, un monitor caido podria
/// tumbar la API con sus reintentos.
const EXENTAS = [/^\/api\/health$/, /^\/api\/ready$/, /^\/api\/docs/];

const esExenta = (req) => EXENTAS.some((patron) => patron.test(req.originalUrl));

const COMUN = {
  windowMs: env.rateLimitWindowMs,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: esExenta,
};

/**
 * La IP que se ve en la peticion no es la del cliente si la API va detras de un
 * proxy: todas llegan desde la maquina de al lado y comparten un mismo limite.
 *
 * `ipKeyGenerator` y no `req.ip` a pelo: una IPv6 viene con su prefijo de /64,
 * asi que un cliente tiene millones de direcciones distintas. Sin agrupar por
 * prefijo, el limite se esquivaria cambiando de direccion.
 */
const clavePorIp = (req) => ipKeyGenerator(req.ip);

/// Limite general de la API. Corta el bucle infinito y el abuso tonto.
export const limitadorGeneral = rateLimit({
  ...COMUN,
  limit: env.rateLimitMax,
  keyGenerator: clavePorIp,
  handler: respondeApi('Demasiadas peticiones. Espera un momento y vuelve a intentarlo.'),
});

/**
 * Limite del login, por IP y por email.
 *
 * Es el que de verdad importa: sin el, un atacante puede probar contrasenas
 * contra una cuenta conocida todo el rato, y cada intento le cuesta a el una
 * peticion y a la victima un hash scrypt.
 *
 * Cuenta solo los fallos (`skipSuccessfulRequests`). Es la diferencia entre una
 * proteccion y una trampa: un usuario que entra bien no gasta nada, y uno que
 * se equivoca cinco veces seguidas tiene que esperar, que es justo lo que un
 * humano hace y un ataque automatizado no.
 *
 * El email va en la clave porque por IP solo no basta: un atacante con cuentas
 * de correo distintas no se frenaria nunca.
 */
export const limitadorLogin = rateLimit({
  ...COMUN,
  limit: env.loginRateLimitMax,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const ip = clavePorIp(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    /// Sin email legible solo queda la IP: nunca una clave vacia, que haria que
    /// todas las peticiones sin email compartieran el mismo contador.
    return email ? `${ip}:${email}` : ip;
  },
  handler: respondeApi('Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.'),
});

/// Recuperar contrasena. Genera un correo por peticion, asi que va mas cerrado.
export const limitadorRecuperacion = rateLimit({
  ...COMUN,
  limit: env.forgotRateLimitMax,
  skipSuccessfulRequests: true,
  keyGenerator: clavePorIp,
  handler: respondeApi(
    'Demasiadas peticiones de recuperacion. Espera unos minutos antes de intentarlo otra vez.'
  ),
});

/**
 * Alta de cuentas, por IP y con TODAS las peticiones contadas.
 *
 * El registro no puede usar el limitador de login: aquel va por `${ip}:${email}`
 * y solo cuenta los fallos. Un atacante que crease cuentas de correo distintas
 * recibia un cubo NUEVO en cada peticion, y como ademas `skipSuccessfulRequests`
 * hacia que los 201 tampoco contaran, no habia ninguna freno al alta masiva. El
 * limite general de la API (300 por 15 minutos) era lo unico que ponia freno, y no
 * es lo bastante.
 *
 * Aqui la clave es solo la IP, se cuentan successes y fallos, y el tope esta bajo:
 * abrir una cuenta es una accion rara y hay que poder hacerlo unas cuantas veces
 * seguidas sin problema, pero no cientos.
 */
export const limitadorRegistro = rateLimit({
  ...COMUN,
  limit: env.registerRateLimitMax,
  keyGenerator: clavePorIp,
  handler: respondeApi(
    'Demasiados registros desde esta conexion. Espera un momento antes de intentarlo otra vez.'
  ),
});

/// Sin limites, para las pruebas automaticas y el desarrollo cómodo.
const sinLimite = (_req, _res, next) => next();

export const limitadores = env.rateLimitEnabled
  ? {
      general: limitadorGeneral,
      login: limitadorLogin,
      recuperacion: limitadorRecuperacion,
      registro: limitadorRegistro,
    }
  : { general: sinLimite, login: sinLimite, recuperacion: sinLimite, registro: sinLimite };

export default limitadores;
