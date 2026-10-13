/**
 * Documento OpenAPI 3 de Agenda26 v2.
 *
 * Va escrito a mano y no generado a partir de los decoradores de Express, por la
 * misma razon que el resto del proyecto no usa framework de validacion: las
 * dependencias de mas son las que hay que actualizar cada tres meses. Cuesta
 * mantenerlo a mano y es el unico sitio donde se describe el CONTRATO, que es lo
 * que importa: si el codigo y el documento no coinciden, el que se equivoca no se
 * sabe, y siempre se sabe cual es.
 */

const bearer = [{ bearerAuth: [] }];

const error = {
  description: 'Error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

/**
 * Atajo para un cuerpo de peticion.
 *
 * El schema es `object` generico a proposito:Swagger UI lo muestra como un objeto
 * libre y se puede pegar el cuerpo real. Un schema por endpoint con todas sus
 * propiedades habria que mantenerlo a mano y se desincronizaria del service en
 * cuanto cambiara una validacion, que es justo cuando mas engaña.
 */
const peticion = (descripcion = 'Cuerpo de la petición') => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object' } } },
  description: descripcion,
});

const idParam = (name = 'id') => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'integer' },
});

const paginated = (ref) => ({
  type: 'object',
  properties: {
    items: { type: 'array', items: { $ref: ref } },
    total: { type: 'integer' },
  },
});

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Agenda26 API',
    version: '2.0.0',
    description: [
      'API de gestion de citas y tareas multi-empresa.',
      '',
      '## Autenticacion',
      '',
      'Access token en la cabecera `Authorization: Bearer <accessToken>`. Caduca en 15 minutos.',
      '',
      'Cuando expira, se llama a `POST /api/auth/refresh` con el `refreshToken` y se reintenta la peticion.',
      'El refresh rota en cada uso.',
      '',
      '## Multi-empresa',
      '',
      'Cada peticion se resuelve sobre el negocio del usuario. El `SUPERADMIN` debe indicar',
      '`?businessId=<id>` en todas las rutas que operen sobre datos.',
      '',
      '## Errores',
      '',
      'Un unico formato: `{ error, details?, requestId }`. `details` es una lista de',
      '`{ field, message }` con TODOS los campos incorrectos, no solo el primero.',
      '',
      'El `requestId` sale tambien en la cabecera `X-Request-Id` de toda respuesta.',
    ].join('\n'),
  },
  servers: [{ url: '/api', description: 'Servidor actual' }],
  tags: [
    { name: 'Sistema', description: 'Salud y disponibilidad del servicio' },
    { name: 'Auth', description: 'Registro, acceso, refresco y recuperacion' },
    { name: 'Negocios', description: 'Empresas (publico y ajustes)' },
    { name: 'Super', description: 'Panel de la plataforma' },
    { name: 'Usuarios', description: 'Cuentas del negocio (nuevo en v2)' },
    { name: 'Profesionales', description: 'Staff y plantillas de agenda (nuevo en v2)' },
    { name: 'Clientes', description: 'Cartera de clientes e historial' },
    { name: 'Categorias', description: 'Catalogo de servicios' },
    { name: 'Tareas', description: 'Lista de trabajo' },
    { name: 'Disponibilidad', description: 'Bloques de agenda y retenciones' },
    { name: 'Citas', description: 'Reservas y ciclo de vida' },
    { name: 'Lista de espera', description: 'Avisos por hueco (nuevo en v2)' },
    { name: 'Notificaciones', description: 'Campana del panel' },
    { name: 'Informes', description: 'Metricas del negocio (nuevo en v2)' },
    { name: 'Auditoria', description: 'Rastro de cambios (nuevo en v2)' },
  ],

  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: { field: { type: 'string' }, message: { type: 'string' } },
            },
          },
          requestId: { type: 'string' },
        },
      },
      Sesion: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'integer', description: 'Segundos hasta que caduca el access token' },
          tokenType: { type: 'string', example: 'Bearer' },
          user: { type: 'object' },
          negocio: { type: 'object' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          nombre: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string', enum: ['SUPERADMIN', 'ADMIN', 'STAFF', 'CLIENT'] },
          activo: { type: 'boolean' },
        },
      },
      Cita: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          status: {
            type: 'string',
            enum: ['PENDING', 'COORDINATED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW'],
          },
          version: {
            type: 'integer',
            description: 'Version optimista. Enviarla al actualizar evita pisar a otro.',
          },
          note: { type: 'string', nullable: true },
          cancelReason: { type: 'string', nullable: true },
          checkedInAt: { type: 'string', format: 'date-time', nullable: true },
          task: { type: 'object' },
          client: { type: 'object' },
          availability: { type: 'object' },
          profesional: { type: 'object', nullable: true },
          historial: { type: 'array', items: { type: 'object' } },
        },
      },
      Disponibilidad: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          date: { type: 'string', example: '2026-10-20' },
          startTime: { type: 'string', example: '09:00' },
          endTime: { type: 'string', example: '10:00' },
          status: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'] },
          citas: { type: 'integer' },
        },
      },
      Cliente: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          nombre: { type: 'string' },
          documento: { type: 'string', nullable: true },
          fechaNacimiento: { type: 'string', nullable: true },
          email: { type: 'string' },
          telefono: { type: 'string', nullable: true },
          notas: { type: 'string', nullable: true },
          edad: { type: 'integer', nullable: true },
          citas: { type: 'integer' },
        },
      },
      ListaClientes: paginated('#/components/schemas/Cliente'),
      ListaCitas: paginated('#/components/schemas/Cita'),
      ListaDisponibilidad: paginated('#/components/schemas/Disponibilidad'),
    },
  },

  paths: {
    /* --- Sistema --- */
    '/health': {
      get: {
        tags: ['Sistema'],
        summary: 'Liveness. El proceso esta vivo. NO consulta la base.',
        responses: { 200: { description: 'Vivo' } },
      },
    },
    '/ready': {
      get: {
        tags: ['Sistema'],
        summary: 'Readiness. Consulta la base. 503 si no responde.',
        responses: {
          200: { description: 'Listo para recibir trafico' },
          503: { description: 'La base no responde' },
        },
      },
    },

    /* --- Auth --- */
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Alta de cliente por la puerta de una empresa',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'nombre',
                  'documento',
                  'fechaNacimiento',
                  'email',
                  'password',
                  'confirmPassword',
                  'negocio',
                ],
                properties: {
                  nombre: { type: 'string' },
                  documento: { type: 'string' },
                  fechaNacimiento: { type: 'string', example: '1990-04-12' },
                  email: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                  confirmPassword: { type: 'string' },
                  telefono: { type: 'string' },
                  direccion: { type: 'string' },
                  negocio: { type: 'string', description: 'Slug de la empresa' },
                  emailOptIn: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Cuenta creada',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Sesion' } } },
          },
          409: error,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Acceso. Sin `negocio` es el acceso de plataforma.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                  negocio: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Sesion iniciada',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Sesion' } } },
          },
          401: error,
          403: error,
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Renovar el access token. El refresh rota en cada uso.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Token renovado',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Sesion' } } },
          },
          401: error,
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Pedir un enlace de recuperacion (nuevo en v2)',
        description:
          'Responde siempre 200, exista o no el correo: decir lo contrario confirma que el correo esta registrado.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'Peticion registrada' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Consumir el enlace de recuperacion (nuevo en v2)',
        description: 'El token es de un solo uso y caduca. Al_RESETAR, se revocan todas las sesiones.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password', 'confirmPassword'],
                properties: {
                  token: { type: 'string' },
                  password: { type: 'string' },
                  confirmPassword: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Contrasena restablecida' }, 400: error },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Estado de la sesion',
        security: bearer,
        responses: { 200: { description: 'Usuario, negocio, rol y citas' }, 401: error },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Cierre de sesion',
        description: 'Con `?todos=true` revoca TODAS las sesiones del usuario.',
        security: bearer,
        responses: { 204: { description: 'Sesion cerrada' } },
      },
    },
    '/auth/password': {
      post: {
        tags: ['Auth'],
        summary: 'Cambio de contrasena',
        security: bearer,
        responses: { 200: { description: 'Cambiada' }, 400: error },
      },
    },
    '/auth/sessions': {
      get: {
        tags: ['Auth'],
        summary: 'Sesiones activas (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Dispositivos con sesion' } },
      },
    },
    '/auth/sessions/{id}': {
      delete: {
        tags: ['Auth'],
        summary: 'Revocar una sesion concreta (nuevo en v2)',
        security: bearer,
        parameters: [{ ...idParam(), name: 'id' }],
        responses: { 204: { description: 'Revocada' }, 404: error },
      },
    },
    '/auth/settings': {
      get: {
        tags: ['Auth'],
        summary: 'Preferencias del usuario (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Preferencias' } },
      },
      patch: {
        tags: ['Auth'],
        summary: 'Cambiar preferencias',
        security: bearer,
        responses: { 200: { description: 'Actualizadas' } },
      },
    },

    /* --- Negocios --- */
    '/negocios': {
      get: {
        tags: ['Negocios'],
        summary: 'Empresas con la puerta abierta (publico)',
        responses: { 200: { description: 'Lista de empresas activas' } },
      },
    },
    '/negocios/{slug}': {
      get: {
        tags: ['Negocios'],
        summary: 'Ficha minima de una empresa (publico)',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Empresa' }, 404: error },
      },
    },
    '/negocios/settings': {
      get: {
        tags: ['Negocios'],
        summary: 'Ajustes del negocio (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Retencion, recordatorios y canales' } },
      },
      patch: {
        tags: ['Negocios'],
        summary: 'Cambiar ajustes',
        security: bearer,
        responses: { 200: { description: 'Actualizados' } },
      },
    },

    /* --- Super --- */
    '/super/negocios': {
      get: {
        tags: ['Super'],
        summary: 'Todas las empresas con sus cifras',
        security: bearer,
        responses: { 200: { description: 'Empresas con admins y metricas' } },
      },
      post: {
        tags: ['Super'],
        summary: 'Alta de empresa con su primer administrador',
        security: bearer,
        responses: { 201: { description: 'Creada' }, 409: error },
      },
    },
    '/super/negocios/{id}': {
      patch: {
        tags: ['Super'],
        summary: 'Editar una empresa',
        description:
          'El `slug` NO se puede cambiar: es la direccion publica (`/b/:slug/login`) y cambiarla rompe los enlaces repartidos.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' }, 404: error },
      },
      delete: {
        tags: ['Super'],
        summary: 'Baja de una empresa',
        description: 'Logica por defecto. Con `?hard=true` borra en cascada de verdad (irreversible).',
        security: bearer,
        parameters: [
          { ...idParam(), schema: { type: 'integer' } },
          { name: 'hard', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { 204: { description: 'Dada de baja' }, 404: error },
      },
    },

    /* --- Usuarios --- */
    '/users': {
      get: {
        tags: ['Usuarios'],
        summary: 'Cuentas del negocio (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Admins, staff y clientes' } },
      },
      post: {
        tags: ['Usuarios'],
        summary: 'Crear una cuenta',
        description: 'Con `?sinPassword=1` genera una temporal y la devuelve una sola vez.',
        security: bearer,
        responses: { 201: { description: 'Creada' }, 409: error },
      },
    },
    '/users/{id}': {
      get: {
        tags: ['Usuarios'],
        summary: 'Cuenta',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Cuenta' }, 404: error },
      },
      put: {
        tags: ['Usuarios'],
        summary: 'Editar una cuenta',
        description: 'No deja a la empresa sin ningun administrador.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' }, 409: error },
      },
      delete: {
        tags: ['Usuarios'],
        summary: 'Desactivar una cuenta',
        description: 'Logico: desactiva y revoca sesiones. No borra.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Desactivada' }, 409: error },
      },
    },

    /* --- Profesionales --- */
    '/staff': {
      get: {
        tags: ['Profesionales'],
        summary: 'Profesionales del negocio (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Lista' } },
      },
      post: {
        tags: ['Profesionales'],
        summary: 'Alta de profesional',
        security: bearer,
        responses: { 201: { description: 'Creado' } },
      },
    },
    '/staff/{id}': {
      get: {
        tags: ['Profesionales'],
        summary: 'Ficha',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Profesional' }, 404: error },
      },
      put: {
        tags: ['Profesionales'],
        summary: 'Editar',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizado' } },
      },
      delete: {
        tags: ['Profesionales'],
        summary: 'Baja logica',
        description:
          'Sus bloques futuros se bloquean en vez de desaparecer, para que las citas que ya tienen no apunten a un hueco inexistente.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Dado de baja' } },
      },
    },
    '/schedules': {
      get: {
        tags: ['Profesionales'],
        summary: 'Plantillas de agenda (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Plantillas por dia de la semana' } },
      },
      post: {
        tags: ['Profesionales'],
        summary: 'Crear plantilla',
        security: bearer,
        responses: { 201: { description: 'Creada' } },
      },
    },
    '/schedules/{id}': {
      put: {
        tags: ['Profesionales'],
        summary: 'Editar plantilla',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' } },
      },
      delete: {
        tags: ['Profesionales'],
        summary: 'Eliminar plantilla',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Eliminada' } },
      },
    },
    '/schedules/generate': {
      post: {
        tags: ['Profesionales'],
        summary: 'Materializar bloques desde las plantillas (nuevo en v2)',
        description:
          'Idempotente: repetir el mismo rango no crea duplicados. Devuelve cuantos creo y cuantos ya estaban.',
        security: bearer,
        requestBody: peticion('{ desde, hasta, dias?: number[], slotMinutes?: number, staffId?: number }'),
        responses: { 200: { description: 'Bloques generados' } },
      },
    },

    /* --- Clientes --- */
    '/clients': {
      get: {
        tags: ['Clientes'],
        summary: 'Listado de clientes',
        description:
          'Acepta `?q=`, `?limit=`, `?offset=` (pagina numerada, con total) o `?cursor=` (pagina por cursor, constante).',
        security: bearer,
        responses: {
          200: {
            description: 'Clientes',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ListaClientes' } } },
          },
        },
      },
      post: {
        tags: ['Clientes'],
        summary: 'Alta de cliente',
        description: 'Sin `password`, genera una temporal y la devuelve una sola vez.',
        security: bearer,
        responses: { 201: { description: 'Creado' }, 409: error },
      },
    },
    '/clients/me': {
      get: {
        tags: ['Clientes'],
        summary: 'Ficha propia',
        security: bearer,
        responses: { 200: { description: 'Ficha' } },
      },
      put: {
        tags: ['Clientes'],
        summary: 'Editar la propia ficha',
        security: bearer,
        responses: { 200: { description: 'Actualizada' } },
      },
    },
    '/clients/me/history': {
      get: {
        tags: ['Clientes'],
        summary: 'Historial del propio cliente (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Citas con fecha y estado' } },
      },
    },
    '/clients/{id}': {
      get: {
        tags: ['Clientes'],
        summary: 'Ficha',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Ficha' }, 404: error },
      },
      put: {
        tags: ['Clientes'],
        summary: 'Editar',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' } },
      },
      delete: {
        tags: ['Clientes'],
        summary: 'Baja de cliente',
        description:
          'Logica por defecto: desactiva la cuenta y cancela las citas futuras conservando el historial. Con `?hard=true` borra en cascada.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Dado de baja' } },
      },
    },
    '/clients/{id}/history': {
      get: {
        tags: ['Clientes'],
        summary: 'Historial del cliente (nuevo en v2)',
        description:
          'Citas con fecha, servicio, profesional y estado. Lo primero que necesita quien atiende.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Historial' }, 404: error },
      },
    },

    /* --- Categorias --- */
    '/categories': {
      get: {
        tags: ['Categorias'],
        summary: 'Catalogo de servicios',
        description: 'Incluye `durationMin` (decide cuanto ocupa en la agenda), `color` y `precio`.',
        security: bearer,
        responses: { 200: { description: 'Catalogo' } },
      },
      post: {
        tags: ['Categorias'],
        summary: 'Alta',
        security: bearer,
        responses: { 201: { description: 'Creada' } },
      },
    },
    '/categories/{id}': {
      put: {
        tags: ['Categorias'],
        summary: 'Editar',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' } },
      },
      delete: {
        tags: ['Categorias'],
        summary: 'Baja logica',
        description: 'Las tareas quedan con categoria nula (SET NULL), no se pierden.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Dada de baja' } },
      },
    },

    /* --- Tareas --- */
    '/tasks': {
      get: {
        tags: ['Tareas'],
        summary: 'Listado de tareas',
        description:
          'Filtros: `estado`, `alcance` (propias|de-citas), `filtro` (pendientes|completadas|sin-fecha|agendadas|vencidas), `categoryId`, `clientId`, `desde`, `hasta`, `q`, `limit`, `offset`.',
        security: bearer,
        responses: { 200: { description: 'Tareas' } },
      },
      post: {
        tags: ['Tareas'],
        summary: 'Alta de tarea',
        security: bearer,
        responses: { 201: { description: 'Creada' } },
      },
    },
    '/tasks/{id}': {
      get: {
        tags: ['Tareas'],
        summary: 'Detalle',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Tarea' }, 404: error },
      },
      put: {
        tags: ['Tareas'],
        summary: 'Editar',
        description: 'Un CLIENT solo puede editar la descripcion y la fecha.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' } },
      },
      delete: {
        tags: ['Tareas'],
        summary: 'Baja logica',
        description:
          'Marca la tarea y cancela sus citas vivas liberando los horarios. Con `?hard=true` borra en cascada.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Dada de baja' } },
      },
    },

    /* --- Disponibilidad --- */
    '/availability': {
      get: {
        tags: ['Disponibilidad'],
        summary: 'Bloques de agenda',
        description: 'Un CLIENT ve solo los `AVAILABLE` y solo desde hoy, en la zona horaria del negocio.',
        security: bearer,
        parameters: [
          { name: 'desde', in: 'query', schema: { type: 'string' } },
          { name: 'hasta', in: 'query', schema: { type: 'string' } },
          {
            name: 'estado',
            in: 'query',
            schema: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'] },
          },
          { name: 'staffId', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          200: {
            description: 'Bloques',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ListaDisponibilidad' } } },
          },
        },
      },
      post: {
        tags: ['Disponibilidad'],
        summary: 'Publicar un bloque',
        description: 'Rechaza solapes con otros bloques que ocupen agenda.',
        security: bearer,
        responses: { 201: { description: 'Publicado' }, 409: error },
      },
    },
    '/availability/{id}': {
      get: {
        tags: ['Disponibilidad'],
        summary: 'Detalle',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Bloque' }, 404: error },
      },
      put: {
        tags: ['Disponibilidad'],
        summary: 'Editar',
        description: 'No se puede liberar a mano un bloque con citas activas.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizado' }, 409: error },
      },
      delete: {
        tags: ['Disponibilidad'],
        summary: 'Baja logica',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Eliminado' }, 409: error },
      },
    },
    '/availability/{id}/hold': {
      post: {
        tags: ['Disponibilidad'],
        summary: 'Retener un hueco mientras se completa la reserva (nuevo en v2)',
        description:
          'Lo marca HELD con caducidad (`settings.holdMinutes`). El worker lo devuelve a AVAILABLE si nadie lo confirma. NO es una reserva.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Retenido' }, 409: error },
      },
      delete: {
        tags: ['Disponibilidad'],
        summary: 'Soltar la retencion',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Suelto' }, 403: error },
      },
    },

    /* --- Citas --- */
    '/appointments': {
      get: {
        tags: ['Citas'],
        summary: 'Listado de citas',
        description:
          'Filtros: `estado`, `clientId`, `staffId`, `categoryId`, `desde`, `hasta`, `q`, `limit`, `offset`. El rango de fechas es el del HORARIO, no el de registro.',
        security: bearer,
        responses: {
          200: {
            description: 'Citas',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ListaCitas' } } },
          },
        },
      },
      post: {
        tags: ['Citas'],
        summary: 'Reservar un horario',
        description: [
          'Un CLIENT se identifica solo (`clientId` se ignora); el staff reserva en nombre de quien sea.',
          '',
          '**Doble booking.** El indice unico parcial `Appointment_hueco_vivo_key` garantiza que no haya dos',
          'citas vivas sobre el mismo hueco. Si dos peticiones llegan a la vez, la segunda recibe 409.',
        ].join('\n'),
        security: bearer,
        requestBody: peticion('{ availabilityId, clientId?, categoryId?, staffId?, title?, note?, status? }'),
        responses: { 201: { description: 'Reservada' }, 400: error, 409: error },
      },
    },
    '/appointments/resumen': {
      get: {
        tags: ['Citas'],
        summary: 'Cifras por estado y las proximas citas (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Resumen del panel' } },
      },
    },
    '/appointments/{id}': {
      get: {
        tags: ['Citas'],
        summary: 'Detalle con historial',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Cita' }, 404: error },
      },
      put: {
        tags: ['Citas'],
        summary: 'Anotar, reprogramar o cambiar de profesional',
        description: 'Manda `version` para evitar pisar a otro administrador que edite a la vez.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Actualizada' }, 409: error },
      },
      delete: {
        tags: ['Citas'],
        summary: 'Baja logica',
        description: 'Marca la cita y libera el horario. Con `?hard=true` borra en cascada.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Eliminada' } },
      },
    },
    '/appointments/{id}/coordinar': {
      post: {
        tags: ['Citas'],
        summary: 'PENDING -> COORDINATED. Envia correo con .ics.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Coordinada' }, 409: error },
      },
    },
    '/appointments/{id}/completar': {
      post: {
        tags: ['Citas'],
        summary: 'COORDINATED -> COMPLETED',
        description: 'El hueco NO vuelve a AVAILABLE: se quedo consumido.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Completada' }, 409: error },
      },
    },
    '/appointments/{id}/no-show': {
      post: {
        tags: ['Citas'],
        summary: 'Marcar ausencia (nuevo en v2)',
        description: 'Exige `noShowReason`. No libera el hueco. Alimenta el informe de ausencias.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Marcada' }, 400: error, 409: error },
      },
    },
    '/appointments/{id}/rechazar': {
      post: {
        tags: ['Citas'],
        summary: 'PENDING -> REJECTED',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Rechazada' }, 400: error, 409: error },
      },
    },
    '/appointments/{id}/cancelar-admin': {
      post: {
        tags: ['Citas'],
        summary: 'Cancelar por la administracion',
        description: 'Exige `cancelReason`. Libera el hueco y avisa a la lista de espera.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Cancelada' }, 400: error, 409: error },
      },
    },
    '/appointments/{id}/cancelar': {
      post: {
        tags: ['Citas'],
        summary: 'El cliente cancela su propia cita',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Cancelada' }, 400: error, 409: error },
      },
    },
    '/appointments/{id}/checkin': {
      post: {
        tags: ['Citas'],
        summary: 'Registro de llegada (nuevo en v2)',
        description: 'Marca `checkedInAt`. No cambia el estado.',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Registrada' }, 409: error },
      },
    },
    '/appointments/{id}/reminders': {
      get: {
        tags: ['Citas'],
        summary: 'Recordatorios de la cita (nuevo en v2)',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Recordatorios' } },
      },
      post: {
        tags: ['Citas'],
        summary: 'Programar un recordatorio',
        security: bearer,
        parameters: [idParam()],
        responses: { 201: { description: 'Programado' }, 400: error },
      },
    },

    /* --- Lista de espera --- */
    '/waitlist': {
      get: {
        tags: ['Lista de espera'],
        summary: 'Entradas de lista de espera (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Lista' } },
      },
      post: {
        tags: ['Lista de espera'],
        summary: 'Apuntarse',
        description: 'Un CLIENT se apunta a si mismo.',
        security: bearer,
        responses: { 201: { description: 'Apuntado' } },
      },
    },
    '/waitlist/{id}': {
      delete: {
        tags: ['Lista de espera'],
        summary: 'Salir de la lista',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Cancelada' }, 404: error },
      },
    },

    /* --- Notificaciones --- */
    '/notifications': {
      get: {
        tags: ['Notificaciones'],
        summary: 'Notificaciones del usuario',
        security: bearer,
        parameters: [
          { name: 'unread', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Notificaciones' } },
      },
    },
    '/notifications/unread-count': {
      get: {
        tags: ['Notificaciones'],
        summary: 'Cuantas hay sin leer',
        security: bearer,
        responses: { 200: { description: 'Contador' } },
      },
    },
    '/notifications/read-all': {
      patch: {
        tags: ['Notificaciones'],
        summary: 'Marcar todas como leidas',
        security: bearer,
        responses: { 200: { description: 'Actualizadas' } },
      },
    },
    '/notifications/{id}/read': {
      patch: {
        tags: ['Notificaciones'],
        summary: 'Marcar una como leida',
        security: bearer,
        parameters: [idParam()],
        responses: { 200: { description: 'Marcada' }, 404: error },
      },
    },
    '/notifications/{id}': {
      delete: {
        tags: ['Notificaciones'],
        summary: 'Descartar (nuevo en v2)',
        description: 'Baja logica: el registro de que se le aviso forma parte del historial.',
        security: bearer,
        parameters: [idParam()],
        responses: { 204: { description: 'Descartada' }, 404: error },
      },
    },

    /* --- Informes --- */
    '/reports/overview': {
      get: {
        tags: ['Informes'],
        summary: 'Cifras de cabecera (nuevo en v2)',
        description: 'Citas por estado, tasa de realizacion, de ausencia y ocupacion.',
        security: bearer,
        responses: { 200: { description: 'Resumen' } },
      },
    },
    '/reports/occupancy': {
      get: {
        tags: ['Informes'],
        summary: 'Ocupacion por dia (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Serie diaria' } },
      },
    },
    '/reports/services': {
      get: {
        tags: ['Informes'],
        summary: 'Que servicios se piden mas (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Ranking' } },
      },
    },
    '/reports/cancellations': {
      get: {
        tags: ['Informes'],
        summary: 'Motivos de cancelacion (nuevo en v2)',
        description: 'Sale del campo `cancelReason`, que en v1 no existia.',
        security: bearer,
        responses: { 200: { description: 'Ranking de motivos' } },
      },
    },
    '/reports/no-show': {
      get: {
        tags: ['Informes'],
        summary: 'Ausencias por profesional (nuevo en v2)',
        security: bearer,
        responses: { 200: { description: 'Ranking' } },
      },
    },
    '/reports/export': {
      get: {
        tags: ['Informes'],
        summary: 'Exportar citas a CSV (nuevo en v2)',
        description: 'Devuelve `text/csv` como adjunto, con BOM para que Excel respete los acentos.',
        security: bearer,
        responses: { 200: { description: 'CSV' } },
      },
    },

    /* --- Auditoria --- */
    '/audit': {
      get: {
        tags: ['Auditoria'],
        summary: 'Rastro de cambios (nuevo en v2)',
        description:
          'Solo lectura. No hay endpoint para escribirla ni para borrarla: un log que se puede editar no vale como log.',
        security: bearer,
        responses: { 200: { description: 'Entradas' } },
      },
    },
    '/audit/{entity}/{entityId}': {
      get: {
        tags: ['Auditoria'],
        summary: 'Rastro de una entidad',
        security: bearer,
        responses: { 200: { description: 'Entradas' } },
      },
    },
  },
};

export default openapi;
