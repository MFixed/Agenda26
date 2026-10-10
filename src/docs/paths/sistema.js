

/** Salud del servicio. Publico: es lo que consulta un monitor o un balanceador. */
export default {
  '/health': {
    get: {
      tags: ['Sistema'],
      summary: 'Estado del servicio',
      security: [],
      responses: {
        200: {
          description: 'El servicio esta vivo.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { status: { type: 'string', example: 'ok' } },
              },
            },
          },
        },
      },
    },
  },
};