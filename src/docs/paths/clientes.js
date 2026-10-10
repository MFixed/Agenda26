import { cuerpo, envuelto, listado, parameters, responses } from '../components.js';

export default {
  '/clients': {
    get: {
      tags: ['Clientes'],
      summary: 'Listado de clientes',
      description: 'Herramienta de trabajo de la administracion: un cliente no puede ver la cartera de la empresa.',
      parameters: [parameters.businessId, parameters.q, parameters.limit, parameters.offset],
      responses: {
        200: {
          description: 'Clientes del negocio.',
          content: { 'application/json': { schema: listado('#/components/schemas/Cliente') } },
        },
        401: responses.error401,
        403: responses.error403,
      },
    },

    post: {
      tags: ['Clientes'],
      summary: 'Alta de cliente',
      description: 'La cuenta de usuario y su ficha nacen juntas. Sin `password` se genera una temporal y se devuelve en `passwordTemporal`: es la unica vez que se puede leer.',
      parameters: [parameters.businessId],
      requestBody: cuerpo({
        type: 'object',
        required: ['nombre', 'documento', 'fechaNacimiento', 'email'],
        properties: {
          nombre: { type: 'string', minLength: 2, maxLength: 120 },
          documento: { type: 'string', minLength: 5, maxLength: 30 },
          fechaNacimiento: { type: 'string', format: 'date' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', description: 'Opcional. Si falta, se devuelve la temporal.' },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
        },
      }),
      responses: {
        201: {
          description: 'Cliente creado.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  envuelto('cliente', '#/components/schemas/Cliente'),
                  {
                    type: 'object',
                    properties: {
                      passwordTemporal: {
                        type: 'string',
                        description: 'Solo si se creo sin contrasena. No se vuelve a poder leer.',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        409: responses.error409,
      },
    },
  },

  '/clients/me': {
    get: {
      tags: ['Clientes'],
      summary: 'Ficha del propio cliente',
      responses: {
        200: {
          description: 'Su ficha.',
          content: { 'application/json': { schema: envuelto('cliente', '#/components/schemas/Cliente') } },
        },
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },

    put: {
      tags: ['Clientes'],
      summary: 'Editar la propia ficha',
      description: 'No toca el rol ni el estado de la cuenta: la reactivacion la decide la administracion. La contrasena se cambia por su propia via (`/auth/password`).',
      requestBody: cuerpo({
        type: 'object',
        required: ['nombre', 'documento', 'fechaNacimiento', 'email'],
        properties: {
          nombre: { type: 'string' },
          documento: { type: 'string' },
          fechaNacimiento: { type: 'string', format: 'date' },
          email: { type: 'string', format: 'email' },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
        },
      }),
      responses: {
        200: {
          description: 'Ficha actualizada.',
          content: { 'application/json': { schema: envuelto('cliente', '#/components/schemas/Cliente') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },
  },

  '/clients/{id}': {
    get: {
      tags: ['Clientes'],
      summary: 'Ficha de un cliente',
      parameters: [parameters.businessId, parameters.id],
      responses: {
        200: {
          description: 'Ficha completa, para el modal de detalle.',
          content: { 'application/json': { schema: envuelto('cliente', '#/components/schemas/Cliente') } },
        },
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },

    put: {
      tags: ['Clientes'],
      summary: 'Editar un cliente',
      description: 'Nombre, email, estado y contrasena viven en la cuenta de usuario: se tocan los dos sitios o la lista y la cuenta dejarian de cuadrar.',
      parameters: [parameters.businessId, parameters.id],
      requestBody: cuerpo({
        type: 'object',
        minProperties: 1,
        description: 'Todos los campos son opcionales, pero hay que mandar alguno.',
        properties: {
          nombre: { type: 'string' },
          documento: { type: 'string' },
          fechaNacimiento: { type: 'string', format: 'date' },
          email: { type: 'string', format: 'email' },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
          password: { type: 'string', format: 'password' },
          activo: { type: 'boolean', description: 'Desactivar la cuenta deja al cliente sin entrar.' },
        },
      }),
      responses: {
        200: {
          description: 'Cliente actualizado.',
          content: { 'application/json': { schema: envuelto('cliente', '#/components/schemas/Cliente') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
        409: responses.error409,
      },
    },

    delete: {
      tags: ['Clientes'],
      summary: 'Baja de cliente',
      description: [
        'Se lleva por delante su cuenta, sus citas y las tareas que solo existian para esas',
        'citas.',
        '',
        'Los horarios vuelven a quedar libres, **salvo los que tuvieron citas completadas**:',
        'esos quedan consumidos y no se reutilizan. Para limpiar un bloque asi hay que',
        'borrar el bloque, que ya no tiene citas encima.',
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