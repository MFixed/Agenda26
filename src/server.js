import express from 'express';
import { join } from 'node:path';
import { router } from './api/router.js';
import { pagesRouter, views } from './pages.routes.js';
import { errorHandler, notFoundHandler } from './utils/errorHandler.js';
import { corsMiddleware } from './middlewares/cors.js';
import { loggerMiddleware } from './middlewares/logger.js';
import { securityMiddleware } from './middlewares/security.js';
import { limitadores } from './middlewares/rateLimit.js';
import { docsRouter } from './docs/docs.routes.js';
import { env } from '../config/env.js';

export function createApp() {
  const app = express();

  // Con la API detras de un proxy, req.ip es la maquina de al lado y todas las
  // peticiones comparten el mismo limite de peticiones. Se declara aqui y no en
  // el limitador para que sea una decision de arranque, visible de un vistazo.
  app.set('trust proxy', env.trustProxy);

  // Los transversales van primero: el log tiene que ver la peticion antes de
  // que la toque el cuerpo, y el preflight de CORS tiene que responderse antes
  // de que ningun router lo tome.
  app.use(loggerMiddleware);
  app.use(securityMiddleware);
  app.use(corsMiddleware);

  app.use(express.json({ limit: '1mb' }));

  // El limite general va por debajo de la documentacion, que se sirve desde los
  // assets estaticos y no tiene por que gastar el cupo de la API.
  app.use('/api', limitadores.general);

  // Documentacion bajo /api, delante del router de la API para que /api/docs no
  // caiga en su notFoundHandler. Se apaga con DOCS_ENABLED=false.
  if (env.docsEnabled) {
    app.use('/api', docsRouter);
  }

  app.use('/api', router);
  // Una ruta de API que no existe responde JSON, no la pagina de error: quien
  // la pide es el frontend, y espera una respuesta de la API.
  app.use('/api', notFoundHandler);

  // Frontend estatico servido por el mismo Express, separado de la API: solo
  // sus assets por aqui, las paginas van por pagesRouter.
  app.use('/css', express.static(join(views, 'css')));
  app.use('/js', express.static(join(views, 'js')));
  app.use(pagesRouter);

  app.use(errorHandler);

  return app;
}