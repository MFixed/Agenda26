/**
 * Piezas compartidas del documento OpenAPI: esquemas de los recursos,
 * parametros que se repiten en varios listados y las respuestas de error.
 *
 * Van aparte de los endpoints para que anadir una ruta sea editar su archivo y
 * no reescribir media especificacion.
 */

/** Respuesta de error. Todas tienen la misma forma: asi el frontend lee una sola. */
export const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

/** Envuelve un esquema en el objeto que devuelve la ruta: `{ cita }`, `{ tarea }`… */
export const envuelto = (nombre, ref) => ({
  type: 'object',
  properties: { [nombre]: { $ref: ref } },
});

/** Listado paginado: `{ items, total }`, el formato de todos los listados. */
export const listado = (ref) => ({
  type: 'object',
  required: ['items', 'total'],
  properties: {
    items: { type: 'array', items: { $ref: ref } },
    total: { type: 'integer', description: 'Cuantos registros hay en total, sin contar `limit`.' },
  },
});

/** Cuerpo JSON de una peticion. */
export const cuerpo = (schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

export const parameters = {
  businessId: {
    name: 'businessId',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1 },
    description: 'Negocio sobre el que opera la peticion. Obligatorio para el SUPERADMIN.',
  },
  id: {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'integer', minimum: 1 },
  },
  limit: {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    description: 'Cuantos registros trae el listado (maximo 500).',
  },
  offset: {
    name: 'offset',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 0, default: 0 },
    description: 'Cuantos registros se saltan, para la paginacion.',
  },
  desde: {
    name: 'desde',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date' },
    description: 'Fecha inicial del rango, `YYYY-MM-DD`.',
  },
  hasta: {
    name: 'hasta',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date' },
    description: 'Fecha final del rango, `YYYY-MM-DD`.',
  },
  q: {
    name: 'q',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'Texto a buscar en los campos que acepta el listado.',
  },
};

export const responses = {
  noContent: { description: 'Baja hecha. Sin cuerpo.' },
  error400: errorResponse('Datos invalidos. Puede traer `details` con los campos concretos.'),
  error401: errorResponse('Falta el token, o el token es invalido o ha caducado.'),
  error403: errorResponse('El rol no permite esta accion, o el recurso es de otro negocio.'),
  error404: errorResponse('No existe, o el rol no puede saber que existe.'),
  error409: errorResponse('Choca con el estado actual: horario ocupado, transicion invalida, dato unico repetido.'),
  // El limite de peticiones. Llega con la cabecera `Retry-After` y con `RateLimit`
  // diciendo cuanto queda, igual que el resto de errores llega con `{ error }`.
  error429: errorResponse('Se han superado las peticiones permitidas en la ventana. Reintentar pasado el `Retry-After`.'),
};

export const schemas = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: { type: 'string', description: 'Mensaje legible del error.' },
      details: {
        type: 'array',
        description: 'Solo en errores de validacion: todos los campos incorrectos a la vez.',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  },

  Negocio: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      nombre: { type: 'string' },
      slug: { type: 'string', example: 'ejemplo', description: 'Identificador de la puerta `/b/:slug/login`.' },
      descripcion: { type: 'string', nullable: true },
      activo: { type: 'boolean' },
    },
  },

  NegocioPanel: {
    allOf: [
      { $ref: '#/components/schemas/Negocio' },
      {
        type: 'object',
        description: 'Lo que ve el panel de la plataforma: la empresa con sus cifras y sus administradores.',
        properties: {
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          admins: { type: 'array', items: { $ref: '#/components/schemas/Admin' } },
          usuarios: { type: 'integer' },
          clientes: { type: 'integer' },
          citas: { type: 'integer' },
        },
      },
    ],
  },

  Admin: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      nombre: { type: 'string' },
      email: { type: 'string', format: 'email' },
      activo: { type: 'boolean' },
    },
  },

  User: {
    type: 'object',
    description: 'El usuario como lo ve el frontend. `tokenVersion` no sale: es interno.',
    properties: {
      id: { type: 'integer' },
      nombre: { type: 'string' },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['SUPERADMIN', 'ADMIN', 'CLIENT'] },
      activo: { type: 'boolean' },
      ultimoAcceso: { type: 'string', format: 'date-time', nullable: true },
      businessId: { type: 'integer', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Sesion: {
    type: 'object',
    required: ['token', 'user'],
    properties: {
      token: {
        type: 'string',
        description: [
          'JWT para mandar en `Authorization: Bearer`.',
          '',
          'Lleva dentro la version del token del usuario. Cerrar sesion o cambiar la',
          'contrasena la sube, y el token deja de valer en la siguiente peticion.',
        ].join(' '),
      },
      user: { $ref: '#/components/schemas/User' },
      negocio: { $ref: '#/components/schemas/Negocio' },
    },
  },

  Cliente: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      userId: { type: 'integer' },
      businessId: { type: 'integer' },
      nombre: { type: 'string' },
      documento: { type: 'string', nullable: true },
      fechaNacimiento: { type: 'string', format: 'date', nullable: true },
      edad: { type: 'integer', nullable: true },
      telefono: { type: 'string', nullable: true },
      direccion: { type: 'string', nullable: true },
      email: { type: 'string', format: 'email', description: 'Vive en la cuenta de usuario, no en la ficha.' },
      activo: { type: 'boolean' },
      ultimoAcceso: { type: 'string', format: 'date-time', nullable: true },
      citas: { type: 'integer' },
      tareas: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Categoria: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      businessId: { type: 'integer' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      tareas: { type: 'integer', description: 'Tareas que usan esta categoria.' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Tarea: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      businessId: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      categoryId: { type: 'integer', nullable: true },
      clientId: { type: 'integer', nullable: true },
      dueDate: { type: 'string', format: 'date', nullable: true },
      dueTime: { type: 'string', nullable: true, example: '09:00' },
      status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] },
      sinFecha: { type: 'boolean', description: 'Es la ausencia de `dueDate`, no un estado guardado.' },
      citas: { type: 'integer', description: 'Citas que usan esta tarea.' },
      category: {
        type: 'object',
        nullable: true,
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
      client: {
        type: 'object',
        nullable: true,
        properties: { id: { type: 'integer' }, nombre: { type: 'string' } },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Disponibilidad: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      businessId: { type: 'integer' },
      date: { type: 'string', format: 'date' },
      startTime: { type: 'string', example: '09:00' },
      endTime: { type: 'string', example: '10:00' },
      status: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'] },
      note: { type: 'string', nullable: true },
      citas: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Cita: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      businessId: { type: 'integer' },
      taskId: { type: 'integer' },
      clientId: { type: 'integer' },
      availabilityId: { type: 'integer' },
      note: { type: 'string', nullable: true },
      status: {
        type: 'string',
        enum: ['PENDING', 'COORDINATED', 'COMPLETED', 'CANCELLED', 'REJECTED'],
        description: 'PENDING → COORDINATED → COMPLETED. Desde PENDING o COORDINATED se pasa a CANCELLED o REJECTED.',
      },
      task: {
        type: 'object',
        description: 'El servicio reservado, que es la tarea que hay detras de la cita.',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] },
          category: {
            type: 'object',
            nullable: true,
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
        },
      },
      client: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          nombre: { type: 'string' },
          telefono: { type: 'string', nullable: true },
          email: { type: 'string', format: 'email', nullable: true },
        },
      },
      availability: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          startTime: { type: 'string', example: '09:00' },
          endTime: { type: 'string', example: '10:00' },
          status: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'] },
        },
      },
      business: {
        type: 'object',
        properties: { id: { type: 'integer' }, nombre: { type: 'string' } },
      },
      historial: { type: 'array', items: { $ref: '#/components/schemas/CitaEvento' } },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  CitaEvento: {
    type: 'object',
    description: 'Cada cambio de estado queda anotado en el historial de la cita.',
    properties: {
      id: { type: 'integer' },
      fromStatus: { type: 'string', nullable: true },
      toStatus: { type: 'string' },
      note: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      actor: {
        type: 'object',
        nullable: true,
        properties: { id: { type: 'integer' }, nombre: { type: 'string' }, role: { type: 'string' } },
      },
    },
  },

  Notificacion: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      userId: { type: 'integer' },
      appointmentId: { type: 'integer', nullable: true },
      channel: { type: 'string', enum: ['INTERNAL', 'EMAIL', 'WHATSAPP'] },
      type: { type: 'string', example: 'APPOINTMENT_COORDINATED' },
      title: { type: 'string' },
      message: { type: 'string' },
      readAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};