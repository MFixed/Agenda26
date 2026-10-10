/**
 * Validadores reutilizables. Devuelven `true` o el mensaje de error, para que
 * quien valida decida como reportarlo.
 */

export const patterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
  // Se admite el formato local con espacios y guiones ("09 123 4567") porque es
  // lo que se teclea en un telefono; el frontend quita los no-digitos al
  // construir el enlace de WhatsApp.
  telefono: /^\+?[0-9][0-9\s-]{5,24}$/,
  documento: /^[0-9A-Za-z-]{5,30}$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  // HH:MM en formato 24 horas
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  // YYYY-MM-DD
  date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  nombre: /^.{2,120}$/,
  titulo: /^.{2,160}$/,
  texto: /^.{2,2000}$/,
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
  nombre: 'Debe tener entre 2 y 120 caracteres',
  titulo: 'Debe tener entre 2 y 160 caracteres',
  texto: 'Debe tener entre 2 y 2000 caracteres',
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

  return { valid: true, value: value.trim() };
}

export function validateInt(value, fieldName, { min = 1, optional = false } = {}) {
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

  return { valid: true, value: parsed };
}

/**
 * Campo opcional: no enviarlo, enviarlo vacio o mandarlo a null significan lo
 * mismo, NULL en la base. Los formularios del frontend mandan "" cuando el
 * usuario borra un campo, asi que el vacio tiene que ser un valor valido.
 */
export function optionalPattern(value, patternName, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: true, value: null };
  }

  return validatePattern(value, patternName, fieldName);
}

/** Entero opcional: igual que optionalPattern, pero numerico. */
export function optionalInt(value, fieldName, { min = 1 } = {}) {
  return validateInt(value, fieldName, { min, optional: true });
}

/**
 * Ejecuta una lista de validaciones y devuelve el objeto ya limpio
 * (trim en strings, numeros convertidos).
 *
 * No se para en el primer fallo: recoge todos los campos incorrectos y los
 * devuelve juntos, porque el frontend los pinta en un solo renglón debajo del
 * formulario y corregir de uno en uno es peor.
 */
export function validateOrThrow(validator, ApiError) {
  const output = {};
  const details = [];

  for (const [fieldName, result] of Object.entries(validator)) {
    if (!result.valid) {
      details.push({ field: fieldName, message: result.message });
      continue;
    }

    if (result.value !== undefined) {
      output[fieldName] = result.value;
    }
  }

  if (details.length > 0) {
    throw new ApiError(400, 'Revisa los datos del formulario', details);
  }

  return output;
}