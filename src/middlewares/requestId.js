import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';

/**
 * Identificador de peticion.
 *
 * Se genera uno por peticion (o se respeta el que venga) y se devuelve en la
 * cabecera `X-Request-Id`. Sin esto, cuando dos peticiones se entrelazan en el
 * log no hay forma de saber que linea es de cual, y un cliente que reporta
 * "me fallo algo" no puede decir cual de las 40 llamadas del primer paint fue.
 *
 * Se respeta el `X-Request-Id` que venga del borde (nginx, gateway, otro
 * servicio) porque si el identificador nace aqui se pierde la correlacion justo
 * en el tramo que mas la necesita: entre el proxy y la app.
 */
export function requestId(req, res, next) {
  const entrante = req.get('x-request-id');

  /// Un id que venga de fuera se acota: sin esto, alguien podria mandar un
  /// cabecera de varios megas y gastarle la memoria a la app en cada peticion.
  const id =
    typeof entrante === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(entrante) ? entrante : randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);

  /*
   * `req.log` se ASIGNA aqui y no se leia en otro sitio.
   *
   * El middleware de peticiones lentas hacia `req.log?.warn(...)`: encadenado
   * opcional sobre algo que nunca se asigno en ningun archivo. El `?.` hacia que
   * no reventara, pero tambien hacia que la alerta NO saliera nunca: la
   * documentacion del middleware prometia un aviso de peticion lenta y no habia
   * ninguno. El export de CSV de los informes escribia por el mismo camino.
   *
   * Va ligado al id de la peticion para que la linea lenta se pueda correlacionar
   * con el resto del rastro.
   */
  req.log = Object.freeze({
    debug: (mensaje, contexto) => logger.debug(mensaje, { requestId: id, ...contexto }),
    info: (mensaje, contexto) => logger.info(mensaje, { requestId: id, ...contexto }),
    warn: (mensaje, contexto) => logger.warn(mensaje, { requestId: id, ...contexto }),
    error: (mensaje, contexto) => logger.error(mensaje, { requestId: id, ...contexto }),
  });

  next();
}

/**
 * Cuanto tarda en responder cada peticion.
 *
 * Sin esto solo se sabe que una peticion fallo, no que la que tardaba 4s fue la
 * que complaintaba el usuario. Va al log en `warn` porque un `debug` no lo ve
 * nadie: si una ruta se pone lenta hay que enterarse sin tener que buscarlo.
 */
export function slowRequest(ms = 1000) {
  return (req, res, next) => {
    const inicio = process.hrtime.bigint();

    res.on('finish', () => {
      const duracion = Number(process.hrtime.bigint() - inicio) / 1e6;

      if (duracion > ms) {
        logger.warn('peticion lenta', {
          requestId: req.id,
          ruta: req.originalUrl,
          metodo: req.method,
          status: res.statusCode,
          ms: Math.round(duracion),
        });
      }
    });

    next();
  };
}

export default { requestId, slowRequest };
