import { env } from '../../config/env.js';
import { parameters, responses, schemas } from './components.js';
import sistema from './paths/sistema.js';
import auth from './paths/auth.js';
import negocios from './paths/negocios.js';
import superPaths from './paths/super.js';
import clientes from './paths/clientes.js';
import categorias from './paths/categorias.js';
import tareas from './paths/tareas.js';
import disponibilidad from './paths/disponibilidad.js';
import citas from './paths/citas.js';
import notificaciones from './paths/notificaciones.js';

/**
 * Documentacion OpenAPI 3 de la API.
 *
 * Se escribe a mano en vez de generarla con comentarios en las rutas: la
 * especificacion es parte del contrato con quien consume la API, y asi se puede
 * leer, revisar y versionar sin arrancar el servidor. Va separada por entidad
 * en `src/docs/paths/`, asi que anadir un endpoint es editar el bloque que le
 * toca.
 */
export const openapi = {
  openapi: '3.0.3',

  info: {
    title: 'API de tareas y citas',
    version: '1.0.0',
    description: [
      'API REST para gestionar negocios, clientes, tareas, disponibilidad y citas.',
      '',
      '### Autenticacion',
      '',
      'Todo lo que no salga como publico usa `Authorization: Bearer <token>`. El token',
      'se obtiene en `POST /auth/login` o `POST /auth/register` y dura lo que diga',
      '`JWT_EXPIRES_IN` (8h por defecto). El boton **Authorize** de esta pagina lo pega por ti.',
      '',
      '### Negocio en contexto',
      '',
      'Cada peticion se resuelve contra un negocio. El ADMIN y el CLIENT estan atados',
      'al suyo; el SUPERADMIN tiene que indicar cual opera con `?businessId=<id>`. Sin ese',
      'parametro, un SUPERADMIN recibe `400`.',
      '',
      '### Errores',
      '',
      'Todos los errores son `{ "error": "mensaje" }` y, cuando son de validacion, anaden',
      '`details: [{ field, message }]` con todos los campos incorrectos a la vez.',
      '',
      '### Fechas',
      '',
      'La agenda trabaja con dias, no con instantes: las fechas viajan como `YYYY-MM-DD` y',
      'las horas como `HH:MM` en formato 24 horas.',
    ].join('\n'),
  },

  servers: [{ url: '/api', description: env.appUrl }],

  tags: [
    { name: 'Sistema', description: 'Salud del servicio' },
    { name: 'Auth', description: 'Registro, acceso y sesion' },
    { name: 'Negocios', description: 'Empresas y sus puertas de acceso' },
    { name: 'Super', description: 'Gestion de empresas desde la plataforma' },
    { name: 'Clientes', description: 'Fichas de cliente' },
    { name: 'Categorias', description: 'Catalogo de servicios de la empresa' },
    { name: 'Tareas', description: 'Trabajo suelto y tareas de cita' },
    { name: 'Disponibilidad', description: 'Bloques de agenda' },
    { name: 'Citas', description: 'Reservas y sus transiciones de estado' },
    { name: 'Notificaciones', description: 'Campana del panel' },
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token de `POST /auth/login` o `POST /auth/register`.',
      },
    },
    parameters,
    schemas,
    responses,
  },

  // Las rutas de verdad, como el router: lo publico no lleva seguridad y el
  // resto hereda el token por bearer.
  security: [{ bearerAuth: [] }],

  paths: {
    ...sistema,
    ...auth,
    ...negocios,
    ...superPaths,
    ...clientes,
    ...categorias,
    ...tareas,
    ...disponibilidad,
    ...citas,
    ...notificaciones,
  },
};

export default openapi;