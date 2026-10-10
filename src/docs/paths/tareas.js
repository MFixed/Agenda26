import { cuerpo, envuelto, listado, parameters, responses } from '../components.js';

const estados = {
  type: 'string',
  enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
};

const alcance = {
  name: 'alcance',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['propias', 'de-citas'], default: 'propias' },
  description: '`propias` aparta las tareas que nacieron de una cita; `de-citas` solo muestra esas.',
};

const filtro = {
  name: 'filtro',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['pendientes', 'completadas', 'sin-fecha', 'agendadas'] },
  description: 'Atajo sobre el estado o la fecha.',
};

export default {
  '/tasks': {
    get: {
      tags: ['Tareas'],
      summary: 'Listado de tareas',
      description: 'Un CLIENT solo ve las tareas asignadas a el, y no puede reasignarlas ni cambiarles el estado.',
      parameters: [
        parameters.businessId,
        { name: 'estado', in: 'query', schema: estados },
        alcance,
        filtro,
        { name: 'categoryId', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'clientId', in: 'query', schema: { type: 'integer', minimum: 1 } },
        parameters.q,
        parameters.desde,
        parameters.hasta,
        parameters.limit,
        parameters.offset,
      ],
      responses: {
        200: {
          description: 'Tareas del negocio.',
          content: { 'application/json': { schema: listado('#/components/schemas/Tarea') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
      },
    },

    post: {
      tags: ['Tareas'],
      summary: 'Alta de tarea',
      description: 'Para el trabajo suelto: una compra, una revision, un aviso. Las tareas que nacen de una cita las crea el servicio de citas.',
      parameters: [parameters.businessId],
      requestBody: cuerpo({
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 160 },
          description: { type: 'string', nullable: true },
          categoryId: { type: 'integer', nullable: true },
          clientId: {
            type: 'integer',
            nullable: true,
            description: 'El CLIENT se asigna la tarea a si mismo y este valor se ignora.',
          },
          dueDate: { type: 'string', format: 'date', nullable: true, description: 'Vacio o null = sin fecha.' },
          dueTime: { type: 'string', nullable: true, example: '09:00' },
          status: { ...estados, default: 'PENDING' },
        },
      }),
      responses: {
        201: {
          description: 'Tarea creada.',
          content: { 'application/json': { schema: envuelto('tarea', '#/components/schemas/Tarea') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
      },
    },
  },

  '/tasks/{id}': {
    get: {
      tags: ['Tareas'],
      summary: 'Detalle de una tarea',
      parameters: [parameters.businessId, parameters.id],
      responses: {
        200: {
          description: 'Tarea encontrada.',
          content: { 'application/json': { schema: envuelto('tarea', '#/components/schemas/Tarea') } },
        },
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },

    put: {
      tags: ['Tareas'],
      summary: 'Editar una tarea',
      description: 'El CLIENT solo puede cambiar la descripcion y mover la fecha: la fecha y la hora son suyas.',
      parameters: [parameters.businessId, parameters.id],
      requestBody: cuerpo({
        type: 'object',
        minProperties: 1,
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          categoryId: { type: 'integer', nullable: true },
          clientId: { type: 'integer', nullable: true },
          dueDate: { type: 'string', format: 'date', nullable: true },
          dueTime: { type: 'string', nullable: true },
          status: estados,
        },
      }),
      responses: {
        200: {
          description: 'Tarea actualizada.',
          content: { 'application/json': { schema: envuelto('tarea', '#/components/schemas/Tarea') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },

    delete: {
      tags: ['Tareas'],
      summary: 'Baja de tarea',
      description: [
          'Se lleva por delante las citas que colgaban de ella.',
          '',
          'Sus horarios vuelven a quedar libres, **salvo los que tuvieron citas completadas**:',
          'esos quedan consumidos y no se reutilizan.',
        ].join(' '),
      parameters: [parameters.businessId, parameters.id],
      responses: {
        204: responses.noContent,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },
  },
};