import { cuerpo, responses } from '../components.js';

const ficha = {
  type: 'object',
  required: ['nombre', 'documento', 'fechaNacimiento', 'email', 'password', 'confirmPassword', 'negocio'],
  properties: {
    nombre: { type: 'string', minLength: 2, maxLength: 120 },
    documento: { type: 'string', minLength: 5, maxLength: 30, example: '12345678' },
    fechaNacimiento: { type: 'string', format: 'date', description: '`YYYY-MM-DD`.' },
    email: { type: 'string', format: 'email' },
    password: {
      type: 'string',
      format: 'password',
      description: 'Al menos 8 caracteres, una mayuscula, una minuscula y un numero.',
    },
    confirmPassword: { type: 'string', format: 'password', description: 'Tiene que coincidir con `password`.' },
    telefono: { type: 'string', nullable: true, example: '+34 600 123 456' },
    direccion: { type: 'string', nullable: true },
    negocio: { type: 'string', description: 'Slug de la empresa por cuya puerta se entra. Obligatorio.' },
  },
};

export default {
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Alta de cliente por la puerta de una empresa',
      description: [
        'Crea una cuenta con rol `CLIENT` ligada al negocio del slug. El rol lo decide la',
        'puerta, nunca el visitante.',
        '',
        'Va con el mismo limite de intentos fallidos que el login: es la otra puerta',
        'abierta, y sin tope searian cuentas en masa.',
        '',
        'Un email ya registrado responde `409` con un mensaje que no dice que campo fue el',
        'que choco: con un mensaje mas claro se podria recorrer correos y sacar la lista de',
        'clientes de la plataforma.',
      ].join(' '),
      security: [],
      requestBody: cuerpo(ficha),
      responses: {
        201: {
          description: 'Cuenta creada. Devuelve el token, asi que no hace falta un login seguido.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Sesion' } } },
        },
        400: responses.error400,
        404: responses.error404,
        409: responses.error409,
        429: responses.error429,
      },
    },
  },

  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Acceso',
      description: [
        'Con `negocio` la cuenta tiene que pertenecer a esa empresa: entrar por la puerta',
        'de otra es `403`, no un error de credenciales. Sin `negocio` es el acceso de la',
        'plataforma (`/login`).',
        '',
        'Limite de intentos fallidos por IP y email: 15 por cada 15 minutos. Los accesos',
        'correctos no gastan cupo. Al agotarse responde `429` con la cabecera `Retry-After`.',
      ].join(' '),
      security: [],
      requestBody: cuerpo({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password' },
          negocio: { type: 'string', description: 'Slug de la empresa. Opcional.' },
        },
      }),
      responses: {
        200: {
          description: 'Credenciales correctas.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Sesion' } } },
        },
        400: responses.error400,
        401: responses.error401,
        403: responses.error403,
        429: responses.error429,
      },
    },
  },

  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Estado de la sesion',
      description: [
        'Lo que el frontend usa para pintar el usuario, el rol y las cifras, y decidir a',
        'que panel va.',
        '',
        'Responde `401` tambien cuando el token era valido pero la sesion se cerro en otro',
        'sitio o se cambio la contrasena.',
      ].join(' '),
      responses: {
        200: {
          description: 'Sesion vigente.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  user: { $ref: '#/components/schemas/User' },
                  negocio: { $ref: '#/components/schemas/Negocio' },
                  citas: { type: 'integer', description: 'Citas del cliente. 0 si la cuenta no es de cliente.' },
                },
              },
            },
          },
        },
        401: responses.error401,
        404: responses.error404,
      },
    },
  },

  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Cierre de sesion',
      description: [
        'Sube la version del token del usuario, con lo que todos sus tokens dejan de',
        'valer en la siguiente peticion. No se guarda lista de revocados: la version va',
        'dentro del JWT y en la base, y `authenticate` las compara.',
        '',
        'Cierra todos los dispositivos de esa cuenta, no solo este. Quien llama tiene que',
        'entrar otra vez para seguir.',
      ].join(' '),
      responses: {
        204: responses.noContent,
        401: responses.error401,
      },
    },
  },

  '/auth/password': {
    post: {
      tags: ['Auth'],
      summary: 'Cambio de contrasena',
      description: [
        'Sube tambien la version del token, asi que si alguien robo un token, cambiar la',
        'clave lo deja fuera. La sesion de quien cambia la contrasena tampoco sobrevive:',
        'el frontend tiene que borrar el token y mandar al login.',
      ].join(' '),
      requestBody: cuerpo({
        type: 'object',
        required: ['passwordActual', 'passwordNueva', 'confirmPassword'],
        properties: {
          passwordActual: { type: 'string', format: 'password' },
          passwordNueva: { type: 'string', format: 'password' },
          confirmPassword: { type: 'string', format: 'password' },
        },
      }),
      responses: {
        200: {
          description: 'Contrasena actualizada.',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { mensaje: { type: 'string' } } },
            },
          },
        },
        400: responses.error400,
        401: responses.error401,
      },
    },
  },
};