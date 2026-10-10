import { Router } from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const views = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');

/**
 * Las paginas del frontend son HTML estatico, pero sus enlaces no llevan
 * extension: /admin/citas, no /admin/appointments.html. Este router traduce
 * cada direccion a su archivo.
 *
 * El frontend decide el panel despues de entrar (comprueba el rol), asi que no
 * hace falta proteger estas rutas: lo que protege la sesion es la API, y una
 * pagina sin token solo muestra el formulario de acceso.
 */
const PAGINAS = {
  '/': 'index.html',
  '/inicio': 'index.html',
  '/login': 'login.html',
  '/registro': 'register.html',
  '/super': 'super.html',
  '/admin': 'admin/dashboard.html',
  '/admin/citas': 'admin/appointments.html',
  '/admin/calendario': 'admin/calendar.html',
  '/admin/tareas': 'admin/tasks.html',
  '/admin/clientes': 'admin/clients.html',
  '/cliente': 'client/dashboard.html',
  '/cliente/citas': 'client/appointments.html',
  '/cliente/perfil': 'client/profile.html',
};

/**
 * La puerta de cada empresa: el mismo login y el mismo registro, con el
 * identificador del negocio en la direccion (/b/:slug/login). El slug lo lee el
 * script de la pagina, no el servidor, asi que aqui solo hay que servirla.
 */
const PUERTAS = {
  '/b/:slug/login': 'login.html',
  '/b/:slug/registro': 'register.html',
};

export const pagesRouter = Router();

for (const [ruta, archivo] of Object.entries({ ...PAGINAS, ...PUERTAS })) {
  pagesRouter.get(ruta, (_req, res) => res.sendFile(join(views, archivo)));
}

// Cualquier otra direccion es una pagina que no existe.
pagesRouter.use((_req, res) => res.status(404).sendFile(join(views, '404.html')));

export { views };