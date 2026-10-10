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
 * - `*` (por defecto): cualquier origen. Cómodo en desarrollo, y lo que no se
 *   debe dejar en produccion si la API tiene datos que proteger.
 * - `http://localhost:5173,https://app.ejemplo.com`: solo esa lista.
 *
 * La API va con token en la cabecera `Authorization`, no con cookies, asi que
 * no hace falta `credentials: true`: sin ella el navegador no manda cookies y
 * una respuesta con `Access-Control-Allow-Origin: *` sigue siendo valida.
 */
const origenes = env.corsOrigins;
const cualquiera = origenes.includes('*');

export const corsMiddleware = cors({
  origin: cualquiera ? true : origenes,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});

export default corsMiddleware;