import cors from 'cors';
import { env } from '../../config/env.js';

/**
 * Cabeceras CORS para las peticiones que llegan desde un navegador.
 *
 * El frontend se sirve desde el mismo Express, asi que en el uso normal CORS no
 * hace falta: solo importa cuando el panel se abre desde otro origen (un Vite
 * en desarrollo, un dominio aparte del de la API en produccion).
 *
 * `CORS_ORIGIN` decide quien puede:
 *
 *  - `*` (por defecto): cualquier origen. Comodo en desarrollo, y lo que no se
 *    debe dejar en produccion si la API tiene datos que proteger.
 *  - `http://localhost:5173,https://app.ejemplo.com`: solo esa lista.
 *
 * La API va con token en la cabecera `Authorization`, no con cookies, asi que no
 * hace falta `credentials: true`: sin ella el navegador no manda cookies y una
 * respuesta con `Access-Control-Allow-Origin: *` sigue siendo valida.
 *
 * En PRODUCCION el comodin es un fallo de arranque, no una opcion: el frontend se
 * sirve desde el mismo Express, asi que un despliegue real no necesita permitir
 * ningun origen externo. Se comprueba al arrancar para que la app no empiece a
 * servir datos con la puerta abierta por un `CORS_ORIGIN` que se dejo en `*` al
 * copiar el `.env.example`. Es el mismo criterio que ya se aplicaba a
 * `EMAIL_TEST_DESTINO`, que se fuerza a vacio en produccion.
 */
const origenes = env.corsOrigins;
const cualquiera = origenes.includes('*');

if (cualquiera && env.isProduction) {
  throw new Error(
    'CORS_ORIGIN esta en "*" en produccion. Define los origenes permitidos separados por comas (por ejemplo: https://app.ejemplo.com).'
  );
}

export const corsMiddleware = cors({
  origin: cualquiera ? true : origenes,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 86_400,
});

export default corsMiddleware;
