import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './openapi.js';

/**
 * Documentacion de la API.
 *
 * El JSON plano en `/api/docs/openapi.json` es la fuente y la pagina en
 * `/api/docs` solo lo pinta: un generador de clientes, Postman o las pruebas
 * automaticas leen el JSON sin pasar por la interfaz.
 *
 * Se monta antes del `notFoundHandler` de la API y antes de las paginas, que
 * responden 404 a cualquier direccion desconocida.
 */
export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openapi);
});

// `swaggerUi.serve` y no `serveFiles`: el primero reparte el mismo
// `swagger-ui-init.js` que deja `setup`, que es donde va incrustado el
// documento. Con `serveFiles` el init sale sin el documento y la pagina
// acaba intentando descargarlo de la raiz.
docsRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    customSiteTitle: 'API de tareas y citas',
    swaggerOptions: {
      // El token que se pega en Authorize sobrevive a recargar la pagina.
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  })
);

export { openapi };