import morgan from 'morgan';
import { env } from '../../config/env.js';

/**
 * Log de peticiones con morgan.
 *
 * El formato sale de `LOG_FORMAT`: `dev` en desarrollo (colorido y corto, una
 * linea por peticion) y `combined` en produccion (el clasico, con remoto, user
 * agent y referer, que es lo que se quiere cuando hay que reconstruir un
 * incidente). `none` lo apaga.
 *
 * Los assets estaticos, la documentacion y `/api/health` quedan fuera del log:
 * el frontend carga sus css y scripts en cada pagina y el monitor pregunta la
 * salud cada pocos segundos, asi que se llenarian de ruido que no ayuda a
 * depurar nada.
 */
const FORMATOS = ['dev', 'combined', 'short', 'tiny', 'common'];

const RUIDOSO = [/^\/css\//, /^\/js\//, /^\/favicon\.ico$/, /^\/api\/health$/, /^\/api\/docs/];

const formato = FORMATOS.includes(env.logFormat)
  ? env.logFormat
  : env.isProduction
    ? 'combined'
    : 'dev';

/**
 * `originalUrl` y no `path`: morgan decide que se salta una peticion cuando la
 * respuesta termina, y para entonces el router ya ha reescrito `req.url` con el
 * tramo que montó (`/health` en vez de `/api/health`). `originalUrl` es lo unico
 * que no cambia nunca.
 */
const esRuido = (req) => RUIDOSO.some((patron) => patron.test(req.originalUrl));

/**
 * Middleware de log. El formato se resuelve una vez al arrancar en vez de en
 * cada peticion: no depende de la peticion.
 */
export const loggerMiddleware =
  env.logFormat === 'none' ? (_req, _res, next) => next() : morgan(formato, { skip: esRuido });

export default loggerMiddleware;