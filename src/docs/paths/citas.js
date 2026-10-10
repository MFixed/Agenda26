import { cuerpo, envuelto, listado, parameters, responses } from '../components.js';

/**
 * Cada accion de estado es una ruta y no un `PATCH` con `{ status }`: asi el
 * estado de destino no lo escribe quien llama y una transicion invalida no se
 * puede alcanzar por error con un estado mal escrito.
 */
function accion(resumen, extra = {}) {
  return {
    tags: ['Citas'],
    summary: resumen,
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { note: { type: 'string', nullable: true, description: 'Queda anotada en el historial.' } },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Estado cambiado.',
        content: { 'application/json': { schema: envuelto('cita', '#/components/schemas/Cita') } },
      },
      401: responses.error401,
      403: responses.error403,
      404: responses.error404,
      409: responses.error409,
    },
    ...extra,
  };
}

export default {
  '/appointments': {
    get: {
      tags: ['Citas'],
      summary: 'Listado de citas',
      description: 'El CLIENT solo ve las suyas. El rango de fechas es el del horario, no el de cuando se pidio la cita.',
      parameters: [
        parameters.businessId,
        {
          name: 'estado',
          in: 'query',
          schema: { type: 'string', enum: ['PENDING', 'COORDINATED', 'COMPLETED', 'CANCELLED', 'REJECTED'] },
        },
        { name: 'clientId', in: 'query', schema: { type: 'integer', minimum: 1 } },
        parameters.q,
        parameters.desde,
        parameters.hasta,
        parameters.limit,
        parameters.offset,
      ],
      responses: {
        200: {
          description: 'Citas del negocio.',
          content: { 'application/json': { schema: listado('#/components/schemas/Cita') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
      },
    },

    post: {
      tags: ['Citas'],
      summary: 'Reservar un horario',
      description: [
        'Crea tambien la tarea del servicio, agenda la cita en el bloque, lo deja en',
        '`RESERVED` y apunta el primer evento y la notificacion, todo en una misma',
        'transaccion: o pasa todo, o el bloque sigue libre.',
        '',
        'El CLIENT reserva para si mismo e ignora cualquier `clientId`.',
      ].join(' '),
      parameters: [parameters.businessId],
      requestBody: cuerpo({
        type: 'object',
        required: ['availabilityId'],
        properties: {
          availabilityId: { type: 'integer', description: 'Bloque a reservar. Tiene que estar AVAILABLE.' },
          clientId: { type: 'integer', description: 'Solo staff: en nombre de quien se reserva.' },
          categoryId: { type: 'integer', description: 'Categoria del servicio. Con ella, `title` se puede omitir.' },
          title: { type: 'string', description: 'Nombre del servicio. Si falta, la cita se titula "Cita".' },
          note: { type: 'string', nullable: true },
          status: {
            type: 'string',
            enum: ['PENDING', 'COORDINATED'],
            default: 'PENDING',
            description: 'La administracion puede registrarla ya confirmada; el cliente no.',
          },
        },
      }),
      responses: {
        201: {
          description: 'Cita reservada.',
          content: { 'application/json': { schema: envuelto('cita', '#/components/schemas/Cita') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
        409: responses.error409,
      },
    },
  },

  '/appointments/resumen': {
    get: {
      tags: ['Citas'],
      summary: 'Cifras por estado',
      description: 'Lo que pinta el panel. El CLIENT cuenta solo con sus propias citas.',
      parameters: [parameters.businessId],
      responses: {
        200: {
          description: 'Resumen del negocio.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  resumen: {
                    type: 'object',
                    properties: {
                      pendientes: { type: 'integer' },
                      coordinadas: { type: 'integer' },
                      completadas: { type: 'integer' },
                      canceladas: { type: 'integer' },
                      rechazadas: { type: 'integer' },
                      hoy: { type: 'integer', description: 'Activas y completadas cuyo horario es hoy.' },
                    },
                  },
                },
              },
            },
          },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
      },
    },
  },

  '/appointments/{id}': {
    get: {
      tags: ['Citas'],
      summary: 'Detalle de una cita',
      description: 'Viene con el historial montado, asi que el modal no necesita una segunda peticion. Sobre una cita ajena un CLIENT recibe `404`, no `403`.',
      parameters: [parameters.businessId, parameters.id],
      responses: {
        200: {
          description: 'Cita encontrada.',
          content: { 'application/json': { schema: envuelto('cita', '#/components/schemas/Cita') } },
        },
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },

    put: {
      tags: ['Citas'],
      summary: 'Anotar o reprogramar',
      description: 'Mover de horario suelta el bloque viejo, reserva el nuevo y desplaza la tarea de detras para que no se desincronice.',
      parameters: [parameters.businessId, parameters.id],
      requestBody: cuerpo({
        type: 'object',
        minProperties: 1,
        properties: {
          availabilityId: { type: 'integer', description: 'Bloque nuevo. Una cita cerrada no se puede mover.' },
          note: { type: 'string', nullable: true },
        },
      }),
      responses: {
        200: {
          description: 'Cita actualizada.',
          content: { 'application/json': { schema: envuelto('cita', '#/components/schemas/Cita') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
        409: responses.error409,
      },
    },

    delete: {
      tags: ['Citas'],
      summary: 'Baja de cita',
      description: [
        'La tarea que colgaba de ella se va con ella, para que no aparezca como una tarea',
        'suelta que nadie ha creado.',
        '',
        'El bloque queda libre **salvo que la cita estuviera COMPLETED**: un horario que se',
        'consumio no vuelve a ponerse a la venta ni aunque se borre el registro.',
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

  '/appointments/{id}/coordinar': {
    post: {
      ...accion('Coordinar la cita', {
        description: 'Confirma el acuerdo. Cierra la tarea como completada y manda al cliente el aviso por correo con el `.ics` adjunto. El correo no bloquea la respuesta: si Resend falla, la cita queda coordinada igual.',
      }),
      parameters: [parameters.businessId, parameters.id],
    },
  },

  '/appointments/{id}/completar': {
    post: {
      ...accion('Completar la cita', {
        description: [
          'Cierra el trabajo: la tarea pasa a COMPLETED.',
          '',
          'El bloque **no** vuelve a AVAILABLE: se queda en RESERVED porque el horario se',
          'consumio al realizarse la cita. El cliente deja de verlo y una reserva nueva',
          'sobre el mismo horario da `409`. Cancelar y rechazar si lo liberan.',
        ].join(' '),
      }),
      parameters: [parameters.businessId, parameters.id],
    },
  },

  '/appointments/{id}/rechazar': {
    post: {
      ...accion('Rechazar la cita', {
        description: 'La cancela la administracion. Solo es valida desde PENDING.',
      }),
      parameters: [parameters.businessId, parameters.id],
    },
  },

  '/appointments/{id}/cancelar-admin': {
    post: {
      ...accion('Cancelar desde la administracion', {
        description: 'Valida desde PENDING o COORDINATED, a diferencia del rechazo.',
      }),
      parameters: [parameters.businessId, parameters.id],
    },
  },

  '/appointments/{id}/cancelar': {
    post: {
      ...accion('Cancelar la cita (cliente)', {
        description: 'El cliente cancela su propia cita. No puede tocar una ajena: responde `404`.',
      }),
      parameters: [parameters.businessId, parameters.id],
    },
  },
};