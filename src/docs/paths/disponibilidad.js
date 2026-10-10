import { cuerpo, envuelto, listado, parameters, responses } from '../components.js';

export default {
  '/availability': {
    get: {
      tags: ['Disponibilidad'],
      summary: 'Bloques de agenda',
      description: 'El CLIENT solo ve lo que puede reservar y solo hacia adelante: un hueco pasado no sirve y uno reservado no debe lacear a otros, asi que su filtro se impone en el servidor.',
      parameters: [
        parameters.businessId,
        parameters.desde,
        parameters.hasta,
        {
          name: 'estado',
          in: 'query',
          schema: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'] },
          description: 'Lo ignora el CLIENT: para el siempre es AVAILABLE.',
        },
        parameters.limit,
      ],
      responses: {
        200: {
          description: 'Bloques del negocio, ordenados por fecha y hora de inicio.',
          content: { 'application/json': { schema: listado('#/components/schemas/Disponibilidad') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
      },
    },

    post: {
      tags: ['Disponibilidad'],
      summary: 'Publicar un bloque',
      description: 'Se rechaza con `409` si se solapa con otro bloque que ya publica agenda en la misma fecha.',
      parameters: [parameters.businessId],
      requestBody: cuerpo({
        type: 'object',
        required: ['date', 'startTime', 'endTime'],
        properties: {
          date: { type: 'string', format: 'date' },
          startTime: { type: 'string', example: '09:00', description: 'HH:MM, anterior a `endTime`.' },
          endTime: { type: 'string', example: '10:00' },
          status: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'], default: 'AVAILABLE' },
          note: { type: 'string', nullable: true },
        },
      }),
      responses: {
        201: {
          description: 'Bloque publicado.',
          content: { 'application/json': { schema: envuelto('disponibilidad', '#/components/schemas/Disponibilidad') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        409: responses.error409,
      },
    },
  },

  '/availability/{id}': {
    get: {
      tags: ['Disponibilidad'],
      summary: 'Detalle de un bloque',
      parameters: [parameters.businessId, parameters.id],
      responses: {
        200: {
          description: 'Bloque encontrado.',
          content: { 'application/json': { schema: envuelto('disponibilidad', '#/components/schemas/Disponibilidad') } },
        },
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },

    put: {
      tags: ['Disponibilidad'],
      summary: 'Editar un bloque',
      description: 'Un bloque con citas vivas no se puede liberar a mano: el servicio de citas es el unico que lo devuelve a AVAILABLE.',
      parameters: [parameters.businessId, parameters.id],
      requestBody: cuerpo({
        type: 'object',
        minProperties: 1,
        properties: {
          date: { type: 'string', format: 'date' },
          startTime: { type: 'string', example: '09:00' },
          endTime: { type: 'string', example: '10:00' },
          status: { type: 'string', enum: ['AVAILABLE', 'HELD', 'RESERVED', 'BLOCKED'] },
          note: { type: 'string', nullable: true },
        },
      }),
      responses: {
        200: {
          description: 'Bloque actualizado.',
          content: { 'application/json': { schema: envuelto('disponibilidad', '#/components/schemas/Disponibilidad') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
        409: responses.error409,
      },
    },

    delete: {
      tags: ['Disponibilidad'],
      summary: 'Baja de bloque',
      description: 'Se rechaza con `409` si tiene citas encima: dejaria citas apuntando a un bloque que ya no existe.',
      parameters: [parameters.businessId, parameters.id],
      responses: {
        204: responses.noContent,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
        409: responses.error409,
      },
    },
  },
};