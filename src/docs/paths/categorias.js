import { cuerpo, envuelto, parameters, responses } from '../components.js';

export default {
  '/categories': {
    get: {
      tags: ['Categorias'],
      summary: 'Catalogo de servicios',
      description: 'Abierto a todos los autenticados: el cliente necesita el catalogo para elegir servicio al pedir una cita.',
      parameters: [parameters.businessId],
      responses: {
        200: {
          description: 'Categorias del negocio.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/Categoria' } },
                },
              },
            },
          },
        },
        401: responses.error401,
        403: responses.error403,
      },
    },

    post: {
      tags: ['Categorias'],
      summary: 'Alta de categoria',
      parameters: [parameters.businessId],
      requestBody: cuerpo({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          description: { type: 'string', nullable: true },
        },
      }),
      responses: {
        201: {
          description: 'Categoria creada.',
          content: { 'application/json': { schema: envuelto('categoria', '#/components/schemas/Categoria') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        409: responses.error409,
      },
    },
  },

  '/categories/{id}': {
    put: {
      tags: ['Categorias'],
      summary: 'Editar una categoria',
      parameters: [parameters.businessId, parameters.id],
      requestBody: cuerpo({
        type: 'object',
        minProperties: 1,
        properties: {
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
      }),
      responses: {
        200: {
          description: 'Categoria actualizada.',
          content: { 'application/json': { schema: envuelto('categoria', '#/components/schemas/Categoria') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
        409: responses.error409,
      },
    },

    delete: {
      tags: ['Categorias'],
      summary: 'Baja de categoria',
      description: 'Las tareas que la usaban quedan sin categoria, no se borran.',
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