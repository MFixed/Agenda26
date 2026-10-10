import { parameters, responses } from '../components.js';

export default {
  '/notifications': {
    get: {
      tags: ['Notificaciones'],
      summary: 'Notificaciones del usuario',
      description: 'La campana del panel. Cada usuario solo ve las suyas, y el aviso por correo es fire and forget: lo que se guarda aqui es la notificacion interna.',
      parameters: [
        {
          name: 'unread',
          in: 'query',
          schema: { type: 'string', enum: ['true', 'false'] },
          description: 'Con `true` sale solo lo no leido.',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      ],
      responses: {
        200: {
          description: 'Notificaciones, de la mas reciente a la mas antigua.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/Notificacion' } },
                },
              },
            },
          },
        },
        401: responses.error401,
      },
    },
  },

  '/notifications/unread-count': {
    get: {
      tags: ['Notificaciones'],
      summary: 'Cuantas hay sin leer',
      responses: {
        200: {
          description: 'Contador para el numero de la campana.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { unread: { type: 'integer' } } },
            },
          },
        },
        401: responses.error401,
      },
    },
  },

  '/notifications/read-all': {
    patch: {
      tags: ['Notificaciones'],
      summary: 'Marcar todas como leidas',
      responses: {
        200: {
          description: 'Cuantas se marcaron.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { updated: { type: 'integer' } } },
            },
          },
        },
        401: responses.error401,
      },
    },
  },

  '/notifications/{id}/read': {
    patch: {
      tags: ['Notificaciones'],
      summary: 'Marcar una como leida',
      parameters: [parameters.id],
      responses: {
        200: {
          description: 'Notificacion marcada.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Notificacion' } },
          },
        },
        401: responses.error401,
        404: responses.error404,
      },
    },
  },
};