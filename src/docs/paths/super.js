import { cuerpo, envuelto, responses } from '../components.js';

export default {
  '/super/negocios': {
    get: {
      tags: ['Super'],
      summary: 'Todas las empresas con sus cifras',
      description: 'Incluye las desactivadas. Lo primero que hace falta cuando una empresa se queda sin acceso.',
      responses: {
        200: {
          description: 'Empresas de la plataforma.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/NegocioPanel' } },
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
      tags: ['Super'],
      summary: 'Alta de empresa con su primer administrador',
      description: 'Se crean juntos y en la misma transaccion: una empresa sin administrador se queda con las puertas cerradas.',
      requestBody: cuerpo({
        type: 'object',
        required: ['nombre', 'slug', 'adminNombre', 'adminEmail', 'adminPassword'],
        properties: {
          nombre: { type: 'string', minLength: 2, maxLength: 120 },
          slug: {
            type: 'string',
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            example: 'clinica-norte',
            description: 'Minusculas y palabras separadas por guiones. Forma parte de la puerta publica.',
          },
          descripcion: { type: 'string', nullable: true },
          adminNombre: { type: 'string' },
          adminEmail: { type: 'string', format: 'email' },
          adminPassword: { type: 'string', format: 'password' },
        },
      }),
      responses: {
        201: {
          description: 'Empresa creada. El mensaje trae la direccion de su puerta de acceso.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mensaje: { type: 'string' },
                  admin: { $ref: '#/components/schemas/Admin' },
                },
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

  '/super/negocios/{id}': {
    patch: {
      tags: ['Super'],
      summary: 'Editar una empresa',
      description: 'El slug no se puede cambiar desde aqui: forma parte de la direccion publica y moverlo rompe los enlaces ya repartidos.',
      parameters: [{ $ref: '#/components/parameters/id' }],
      requestBody: cuerpo({
        type: 'object',
        minProperties: 1,
        description: 'Hay que mandar al menos un campo.',
        properties: {
          nombre: { type: 'string' },
          descripcion: { type: 'string', nullable: true },
          activo: { type: 'boolean', description: 'Desactivar cierra las puertas sin borrar nada.' },
        },
      }),
      responses: {
        200: {
          description: 'Empresa actualizada.',
          content: { 'application/json': { schema: envuelto('negocio', '#/components/schemas/Negocio') } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        404: responses.error404,
      },
    },
  },
};