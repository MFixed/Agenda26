import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../../config/env.js';

/**
 * Limite de peticiones, en memoria y sin Redis.
 *
 * Es una decision consciente: el contador vive en un `Map` del propio proceso.
 * Con una sola instancia es exactamente igual de efficace que Redis y no exige
 * levantar un servicio mas. Con varias instancias, cada una lleva su cuenta y
 * el tope real es `limite x instancias`, asi que hay que bajar el limite al
 * repartir. Es el trade-off de no depender de infraestructura extra, y cuando
 * haga falta cambiar a un almacen compartido el cambio se queda en este
 * archivo: `express-rate-limit` lo permite por constructor.
 *
 * Los limites van a proposito mas altos de lo que parece. Un limitador mal
 * puesto no protege: solo hace que la aplicacion deje de funcionar para quien
 * la usa de verdad.
 */

/**
 * El error del limite sale con la misma forma que el resto de la API
 * (`{ error }`) en vez del texto plano que pone la libreria por defecto, para
 * que el frontend no tenga un segundo formato que aprender.
 */
const respondeApi = (mensaje) => (req, res) => {
  res.status(429).json({
    error: mensaje,
    details: [
      {
        field: 'rate',
        message: `Espera un momento antes de volver a intentarlo (${Math.ceil(
          (Number(res.getHeader('Retry-After')) || 60),
          0,
        )} s).`,
      },
    ],
  });
};

// Las peticiones que se responden siempre, ni se cuentan ni se limitan: sin
// ellas un monitor caido podría tumbar la API con sus reintentos.
const EXENTAS = [/^\/api\/health$/, /^\/api\/docs/];

const esExenta = (req) => EXENTAS.some((patron) => patron.test(req.originalUrl));

/**
 * La IP que se ve en la peticion no es la del cliente si la API va detras de un
 * proxy o un balanceador: todas las peticiones llegan desde la maquina de
 * al lado. Sin esto, un proxy delante haria que todo el trafico compartiera un
 * mismo limite y el primero que moleste tumbaria la API entera.
 *
 * `TRUST_PROXY=1` dice que hay exactamente un proxy delante. Hay que activarlo
 * solo si es verdad: puesto sin querer, un cliente podria mandar su propia
 * cabecera `X-Forwarded-For` y saltarse el limite falseando esa IP.
 */
const configProxy = () => {
  const confianza = process.env.TRUST_PROXY;

  if (confianza) {
    const numero = Number(confianza);
    return Number.isInteger(numero) && numero > 0 ? numero : confianza === 'true';
  }

  return env.isProduction ? 1 : false;
};

const COMUN = {
  windowMs: env.rateLimitWindowMs,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: esExenta,
};

/** Limite general de la API. Corta el bucle infinito y el abuso tonto. */
export const limitadorGeneral = rateLimit({
  ...COMUN,
  limit: env.rateLimitMax,
  handler: respondeApi('Demasiadas peticiones. Espera un momento y vuelve a intentarlo.'),
});

/**
 * Limite del login, por IP y por email.
 *
 * Es el que de verdad importa: sin el, un atacante puede probar contrasenas
 * contra una cuenta conocida todo el rato, y cada intento le cuesta a el una
 * peticion y a la victima un hash scrypt.
 *
 * Cuenta solo los fallos (`skipSuccessfulRequests`). Es la diferencia entre
 * una proteccion y una trampa: un usuario que entra bien no gasta nada, y uno
 * que se equivoca cinco veces seguidas tiene que esperar, que es justo lo que
 * un humano hace y un ataque automatizado no.
 *
 * El email va en la clave porque por IP solo no basta: un atacante con cuentas
 * de correo distintas (botnet) no se frenaria nunca.
 */
export const limitadorLogin = rateLimit({
  ...COMUN,
  limit: env.loginRateLimitMax,
  skipSuccessfulRequests: true,
  keyGenerator: (req, res) => {
    // `ipKeyGenerator` y no `req.ip` a pelo: una IPv6 viene con su prefijo de
    // /64, asi que un cliente tiene millones de direcciones distintas. Sin
    // agrupar por prefijo, el limite se esquivaria cambiando de direccion.
    const ip = ipKeyGenerator(req.ip);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    // Sin email legible solo queda la IP: nunca una clave vacia, que haria que
    // todas las peticiones sin email compartieran el mismo contador.
    return email ? `${ip}:${email}` : ip;
  },
  handler: respondeApi('Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.'),
});

/** Sin limites, para las pruebas automaticas: un `Map` vacio como middleware. */
const sinLimite = (_req, _res, next) => next();

export const limitadores = env.rateLimitEnabled
  ? { general: limitadorGeneral, login: limitadorLogin }
  : { general: sinLimite, login: sinLimite };

export default limitadores;