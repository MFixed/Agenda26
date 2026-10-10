/**
 * Fechas de la agenda. La agenda trabaja con dias, no con instantes: un
 * horario es "el 20/10 a las 09:00", no "el 20/10T09:00:00.000Z".
 *
 * Por eso los dias se guardan a medianoche UTC y se devuelven como
 * 'YYYY-MM-DD': es el formato que el navegador acepta en <input type="date"> y
 * el que se puede comparar como texto sin sorpresas de zona horaria.
 */

/** 'YYYY-MM-DD' -> Date a medianoche UTC. */
export function parseDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date -> 'YYYY-MM-DD'. */
export function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  const fecha = value instanceof Date ? value : new Date(value);

  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
}

/**
 * El "hoy" del servidor en su propia zona horaria. La agenda se lee con el
 * calendario del navegador, que va en la zona de quien mira; si el dia se
 * calculara en UTC, por la tarde en America el "hoy" seria ya el de manana.
 */
export function hoyLocal() {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}