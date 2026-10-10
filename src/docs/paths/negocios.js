import { envuelto, responses } from '../components.js';

export default {
  '/negocios': {
    get: {
      tags: ['Negocios'],
      summary: 'Empresas con la puerta abierta',
      description: 'Listado publico. Sin token, porque quien todavia no ha entrado es justo quien necesita saber a que empresa va a entrar.',
      security: [],
      responses: {
        200: {
          description: 'Empresas activas.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/Negocio' } },
                },
              },
            },
          },
        },
      },
    },
  },

  '/negocios/{slug}': {
    get: {
      tags: ['Negocios'],
      summary: 'Ficha minima de una empresa',
      description: 'Es lo que pinta su puerta de acceso (`/b/:slug/login`) con el nombre del negocio. Una empresa desactivada responde 404, como si no existiera.',
      security: [],
      parameters: [
        {
          name: 'slug',
          in: 'path',
          required: true,
          schema: { type: 'string', example: 'ejemplo' },
        },
      ],
      responses: {
        200: {
          description: 'Empresa encontrada.',
          content: { 'application/json': { schema: envuelto('negocio', '#/components/schemas/Negocio') } },
        },
        404: responses.error404,
      },
    },
  },
};