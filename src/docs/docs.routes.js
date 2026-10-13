import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './openapi.js';

/**
 * Documentacion de la API.
 *
 * El JSON plano en `/api/openapi.json` es la fuente y la pagina en
 * `/api/docs` solo lo pinta: un generador de clientes, Postman o las pruebas
 * automaticas leen el JSON sin pasar por la interfaz.
 *
 * La ruta del JSON es `/api/openapi.json` y NO `/api/docs/openapi.json`: este
 * router se monta en `/api` y el `'/docs'` que le pone Swagger es el de la pagina
 * web, que va una pantalla dentro. Antes el comentario de aqui prometia una URL que
 * no existia, y quien la copiaba en Postman se comia un 404.
 *
 * Se monta antes del `notFoundHandler` de la API y antes de las paginas, que
 * responden 404 a cualquier direccion desconocida.
 */
export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openapi);
});

/// `swaggerUi.serve` y no `serveFiles`: el primero reparte el mismo
/// `swagger-ui-init.js` que deja `setup`, que es donde va incrustado el documento.
/// Con `serveFiles` el init sale sin el documento y la pagina acaba intentando
/// descargarlo de la raiz.
docsRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    customSiteTitle: 'Agenda26 API v2',
    swaggerOptions: {
      /// El token que se pega en Authorize sobrevive a recargar la pagina.
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
    },
  })
);

export { openapi };
