import { ApiError } from './ApiError.js';
import { zonaValida } from './dates.js';

/**
 * Validadores reutilizables.
 *
 * Devuelven `{ valid, value }` o `{ valid: false, message }`, nunca lanzan: quien
 * valida decide como reportar. Asi el mismo patron sirve para el cuerpo de una
 * peticion y para una variable de entorno.
 */

export const patterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  /// Min 8, una minuscula, una mayuscula y un numero. El diagnostico es unhelpful
  /// ("debe tener entre 8 y 32 caracteres") cuando lo que falla es la mayuscula,
  /// asi que el mensaje lista lo que hace falta.
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
  /// Telefono: se admiten espacios y guiones porque es lo que se teclea. El
  /// frontend quita los no-digitos al construir el enlace de WhatsApp.
  telefono: /^\+?[0-9][0-9\s-]{5,24}$/,
  documento: /^[0-9A-Za-z-]{5,30}$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /// HH:MM en 24 horas. Se compara como texto sin convertir a Date.
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  /// YYYY-MM-DD. No valida que exista la fecha (2026-02-31) a proposito: eso lo
  /// hace el constructor de Date, que normaliza al dia siguiente y avisa.
  date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  /// IANA, para que la base pueda calcular "hoy" en la zona de la empresa.
  timezone: /^[A-Za-z]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/,
  hex: /^#?[0-9a-fA-F]{6}$/,
  nombre: /^.{2,120}$/,
  titulo: /^.{2,160}$/,
  texto: /^.{2,2000}$/,
  /// Nota libre de una cita o un motivo de cancelacion.
  nota: /^.{0,500}$/,
  direccion: /^.{2,240}$/,
};

const messages = {
  email: 'Debe ser un email valido',
  password: 'Debe tener al menos 8 caracteres, una mayuscula, una minuscula y un numero',
  telefono: 'Debe contener solo numeros, espacios, guiones y opcionalmente un +',
  documento: 'Debe tener entre 5 y 30 caracteres alfanumericos',
  slug: 'Debe ser minusculas y palabras separadas por guiones',
  time: 'Debe tener formato HH:MM (24 horas)',
  date: 'Debe tener formato YYYY-MM-DD',
  timezone: 'Debe ser una zona horaria valida (por ejemplo America/Montevideo)',
  hex: 'Debe ser un color hexadecimal (por ejemplo #2563eb)',
  nombre: 'Debe tener entre 2 y 120 caracteres',
  titulo: 'Debe tener entre 2 y 160 caracteres',
  texto: 'Debe tener entre 2 y 2000 caracteres',
  nota: 'No puede pasar de 500 caracteres',
  direccion: 'Debe tener entre 2 y 240 caracteres',
};

export function validatePattern(value, patternName, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { valid: false, message: `${fieldName} es obligatorio` };
  }

  const pattern = patterns[patternName];

  if (!pattern.test(value.trim())) {
    return { valid: false, message: `${fieldName}: ${messages[patternName]}` };
  }

  /*
   * La zona horaria se comprueba con Intl y no solo con el patron.
   *
   * El patron `/^[A-Za-z]+\/[A-Za-z_]+.../` acepta "America/Inventada", que es
   * exactamente el tipo de errata que se cuela al teclear. Intl lanza con una zona
   * que no existe, asi que es el unico que puede decir la verdad.
   *
   * Sin esto, un negocio con una zona mal escrita guardaba su agenda con el "hoy"
   * de UTC sin enterarse, y el dia en que se notara nadie recordaria haberla escrito
   * asi.
   */
  if (patternName === 'timezone' && !zonaValida(value.trim())) {
    return { valid: false, message: `${fieldName}: ${messages.timezone}` };
  }

  return { valid: true, value: value.trim() };
}

export function validateInt(
  value,
  fieldName,
  { min = 1, max = Number.MAX_SAFE_INTEGER, optional = false } = {}
) {
  if (value === undefined || value === null || value === '') {
    return optional ? { valid: true, value: null } : { valid: false, message: `${fieldName} es obligatorio` };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return { valid: false, message: `${fieldName} debe ser un numero entero` };
  }

  if (parsed < min) {
    return { valid: false, message: `${fieldName} debe ser mayor o igual a ${min}` };
  }

  if (parsed > max) {
    return { valid: false, message: `${fieldName} no puede pasar de ${max}` };
  }

  return { valid: true, value: parsed };
}

export function validateBool(value, fieldName) {
  if (typeof value === 'boolean') return { valid: true, value };

  if (value === 'true') return { valid: true, value: true };
  if (value === 'false') return { valid: true, value: false };

  return { valid: false, message: `${fieldName} debe ser booleano` };
}

export function validateOneOf(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    return { valid: false, message: `${fieldName} debe ser uno de: ${allowed.join(', ')}` };
  }

  return { valid: true, value };
}

/**
 * Campo opcional: no enviarlo, mandarlo vacio o mandarlo a null significan lo
 * mismo. Los formularios mandan "" cuando el usuario borra un campo, asi que el
 * vacio tiene que ser un valor valido y no un error.
 */
export function optionalPattern(value, patternName, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: true, value: null };
  }

  return validatePattern(value, patternName, fieldName);
}

export function optionalInt(value, fieldName, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  return validateInt(value, fieldName, { min, max, optional: true });
}

/**
 * Ejecuta una lista de validaciones y devuelve el objeto ya limpio.
 *
 * No se para en el primer fallo: recoge todos los campos incorrectos y los
 * devuelve juntos, porque el frontend los pinta en un solo renglón debajo del
 * formulario y corregirlos de uno en uno obliga a enviar el formulario N veces.
 */
export function validateOrThrow(validator) {
  const output = {};
  const details = [];

  for (const [fieldName, result] of Object.entries(validator)) {
    /*
     * Una clave con valor `undefined` NO es un campo fallo: es un campo que no ha
     * llegado. Los validadores por endpoint los escriben asi a proposito
     * (`campo: body.campo === undefined ? undefined : validar(...)`), para poder
     * dejar el esquema a la vista en vez de montar un objeto condicional.
     *
     * Sin este `continue`, `result.valid` reventaba con "Cannot read properties of
     * undefined" y el endpoint devolvia un 500 en vez de validar el resto.
     *
     * "No lo ha mandado" y "lo ha mandado mal" son cosas distintas, y aqui se
     * tratan como distintas.
     */
    if (result === undefined || result === null) continue;

    if (!result.valid) {
      details.push({ field: fieldName, message: result.message });
      continue;
    }

    if (result.value !== undefined) {
      output[fieldName] = result.value;
    }
  }

  if (details.length > 0) {
    throw ApiError.badRequest('Revisa los datos del formulario', details);
  }

  return output;
}

/**
 * Igual que validateOrThrow, pero exige al menos un campo en el cuerpo.
 *
 * Sin esto un `PUT` con `{}` llega hasta el service y actualiza una fila sin
 * cambiar nada: la peticion parece que funciono y no se toco nada.
 */
export function validatePatch(validator) {
  const data = validateOrThrow(validator);

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No enviaste ningun campo para actualizar');
  }

  return data;
}

/**
 * Copia de un objeto sin las claves indicadas.
 *
 * Sirve para lo que se hacia desestructurando: `const { password, ...resto } =
 * datos`. Funciona, pero deja una variable muerta por cada clave descartada, y el
 * linter avisa de cada una. En un archivo con cuatro de esas se convierte en ruido
 * que acaba ignorándose, y entonces deja de servir para nada.
 *
 * El nombre deja claro que lo que se quita son claves CONOCIDAS. Si lo que se
 * quiere es quitar las PRIVADAS de un usuario, `USER_PUBLICO` en el servicio de
 * auth usa una lista blanca, que es lo correcto.
 */
export function omitir(objeto, ...claves) {
  const fuera = new Set(claves);

  return Object.fromEntries(Object.entries(objeto ?? {}).filter(([clave]) => !fuera.has(clave)));
}

export default {
  patterns,
  validatePattern,
  optionalPattern,
  validateInt,
  optionalInt,
  validateBool,
  validateOneOf,
  validateOrThrow,
  validatePatch,
  omitir,
};
