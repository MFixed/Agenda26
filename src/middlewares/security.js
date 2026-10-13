import helmet from 'helmet';
import { env } from '../../config/env.js';

/**
 * Cabeceras de seguridad.
 *
 * Lo que mas llama la atencion es lo que helmet apaga por defecto en Express:
 * `X-Powered-By: Express` dice la pila tecnica a cualquiera que pregunte con un
 * `curl -I`.
 *
 * La CSP viene laxa a proposito, no por descuido. El frontend es HTML estatico
 * sin build: `views/index.html` lleva su script como `<script type="module">`
 * embebido y hay `style="..."` en linea en varias pantallas, asi que sin
 * `unsafe-inline` la aplicacion se quedaria en blanco. Swagger UI tambien lo
 * necesita: su CSS va dentro de un `<style>` de la pagina.
 *
 * Lo que si se deja cerrado es lo que no cuesta: no se puede embeber en un
 * iframe, no se puede meter contenido de otro tipo, y solo se cargan recursos de
 * este mismo origen.
 */
const CSP = {
  directives: {
    defaultSrc: ["'self'"],
    /// El script embebido de index.html obliga a esta excepcion.
    scriptSrc: ["'self'", "'unsafe-inline'"],
    /// Los style="..." en linea de las pantallas, y el <style> de Swagger UI.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    /// helmet lo pone por defecto y en desarrollo hace dano: obliga al
    /// navegador a reescribir cada peticion a https. En localhost no pasa nada
    /// (Chrome lo trata como origen seguro), pero al probar desde la IP de la
    /// maquina en la red local sobre http plano, la aplicacion dejaria de
    /// cargar. En produccion detras de TLS se deja puesto.
    upgradeInsecureRequests: env.isProduction ? [] : null,
  },
};

export const securityMiddleware = helmet({
  /// CSP ya viene con la forma que helmet espera ({ directives }). Envolverlo en
  /// otro `{ directives }` hacia que helmet receive `CSP` como valor de
  /// `directives`, que no es iterable.
  contentSecurityPolicy: env.cspEnabled ? CSP : false,
  /// En desarrollo la app se abre en http://localhost; HSTS sobre http no hace
  /// nada y en produccion lo pone el que termina TLS delante.
  hsts: env.isProduction ? undefined : false,
  /// helmet pondria SAMEORIGIN, pero la CSP de arriba ya dice frame-ancestors
  /// 'none'. Que las dos cabeceras digan cosas distintas es peor que no poner
  /// ninguna: se deja en 'deny' para que coincidan.
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'same-origin' },
});

export default securityMiddleware;
