import { logger } from '../../config/logger.js';

/**
 * Log de peticiones.
 *
 * Sustituye a morgan por el logger estructurado. La razon no es la sintaxis:
 * es que morgan escribe texto plano, y un texto plano no se puede indexar ni
 * correlacionar. Con `req.id` presente en cada linea, dos peticiones simultaneas
 * dejan de ser un enredo.
 *
 * Se salta lo que no aporta: los assets estaticos, la documentacion y
 * `/api/health`. El frontend carga sus css y scripts en cada pagina y un monitor
 * pregunta la salud cada pocos segundos: metidos en el log, llenarian de ruido
 * que no ayuda a depurar nada.
 */
const RUIDOSO = [
  /^\/css\//,
  /^\/js\//,
  /^\/favicon\.ico$/,
  /^\/api\/health$/,
  /^\/api\/ready$/,
  /^\/api\/docs/,
];

/**
 * `originalUrl` y no `path`: Express reescribe `req.url` con el tramo que monto
 * el router (`/health` en vez de `/api/health`), y para cuando morgan decide si
 * se salta una peticion, ya esta reescrito. `originalUrl` no cambia nunca.
 */
const esRuido = (req) => RUIDOSO.some((patron) => patron.test(req.originalUrl));

export function requestLogger(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    if (esRuido(req)) return;

    const ms = Math.round(Number(process.hrtime.bigint() - inicio) / 1e5) / 10;
    const contexto = {
      requestId: req.id,
      metodo: req.method,
      ruta: req.originalUrl,
      status: res.statusCode,
      ms,
      userId: req.user?.id ?? null,
      ip: req.ip,
    };

    /// 5xx es un fallo del servidor: error. 4xx es culpa de quien llama: warn.
    /// 3xx y 2xx, info.
    if (res.statusCode >= 500) {
      logger.error('peticion fallida', contexto);
    } else if (res.statusCode >= 400) {
      logger.warn('peticion rechazada', contexto);
    } else {
      logger.info('peticion', contexto);
    }
  });

  next();
}

export default requestLogger;
