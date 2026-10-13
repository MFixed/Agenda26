import express from 'express';
import { join } from 'node:path';
import { router } from './api/router.js';
import { pagesRouter, views } from './pages.routes.js';
import { errorHandler, notFoundHandler } from './utils/ApiError.js';
import { corsMiddleware } from './middlewares/cors.js';
import { requestLogger } from './middlewares/logger.js';
import { securityMiddleware } from './middlewares/security.js';
import { requestId, slowRequest } from './middlewares/requestId.js';
import { limitadores } from './middlewares/rateLimit.js';
import { docsRouter } from './docs/docs.routes.js';
import { env } from '../config/env.js';

export function createApp() {
  const app = express();

  /**
   * Con la API detras de un proxy, `req.ip` es la maquina de al lado y todas las
   * peticiones comparten el mismo limite. Se declara aqui y no en el limitador para
   * que sea una decision de arranque, visible de un vistazo.
   */
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  /**
   * El identificador de peticion va lo primero de todo: sin el, las lineas de
   * middleware que corran antes de el no tendrian nada que correlacionar con las que
   * van despues. Es un detalle de 4 lineas que cambia por completo la posibilidad de
   * seguir el rastro de un fallo.
   */
  app.use(requestId);
  app.use(requestLogger);
  app.use(slowRequest(1000));

  /**
   * Los transversales van en este orden: el log tiene que ver la peticion antes de
   * que la toque el cuerpo, y el preflight de CORS tiene que responderse antes de
   * que ningun router lo tome.
   */
  app.use(securityMiddleware);
  app.use(corsMiddleware);

  app.use(express.json({ limit: '1mb' }));

  /**
   * El limite general va por debajo de la documentacion, que se sirve desde los
   * assets estaticos y no tiene por que gastar el cupo de la API.
   */
  app.use('/api', limitadores.general);

  /**
   * Documentacion bajo /api, delante del router de la API para que /api/docs no
   * caiga en su notFoundHandler. Se apaga con DOCS_ENABLED=false.
   */
  if (env.docsEnabled) {
    app.use('/api', docsRouter);
  }

  app.use('/api', router);

  /**
   * Una ruta de API que no existe responde JSON, no la pagina de error: quien la
   * pide es el frontend, y espera una respuesta de la API.
   */
  app.use('/api', notFoundHandler);

  /**
   * Frontend estatico servido por el mismo Express, separado de la API: solo sus
   * assets por aqui, las paginas van por pagesRouter.
   *
   * La cache es CORTA y revalidable, no un dia sin version en el nombre del fichero.
   *
   * Con `maxAge: '1d'` y ficheros sin hash (`api.js`, no `api.a7f3c1.js`), un
   * despliegue que cambia un `.js` deja a todos los navegadores sirviendo el anterior
   * desde su cache hasta un dia despues: se despliega el arreglo, el log no da ni un
   * error y el fallo aparece en clientes con el panel abierto a medias.
   *
   * Con una hora y revalidacion (el ETag que manda Express convierte el resto en un
   * `304` vacio), el coste es una peticion condicional por recurso y el que tiene el
   * panel abierto recibe los cambios en una recarga.
   */
  const CACHE_ESTATICOS = {
    maxAge: env.isProduction ? '1h' : 0,
    etag: true,
    lastModified: true,
  };

  app.use('/css', express.static(join(views, 'css'), CACHE_ESTATICOS));
  app.use('/js', express.static(join(views, 'js'), CACHE_ESTATICOS));

  app.use(pagesRouter);

  app.use(errorHandler);

  return app;
}

export default createApp;
