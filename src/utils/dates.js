/**
 * Fechas y zonas horarias de la agenda.
 *
 * La agenda trabaja con dias, no con instantes: un horario es "el 20/10 a las
 * 09:00", no "el 20/10T09:00:00.000Z". Por eso los dias se guardan a medianoche
 * UTC y se devuelven como 'YYYY-MM-DD', que es lo que acepta `<input type="date">`
 * y lo que se puede comparar como texto sin sorpresas de zona horaria.
 *
 * v2 anade lo que a v1 le faltaba: la zona horaria de la empresa. Sin ella, el
 * "hoy" de una clinica en Montevideo calculado en un servidor en UTC era el dia
 * equivocado a partir de las 21:00. Ahora el "hoy" se calcula en la zona del
 * negocio.
 */

/** Zonas admitidas. No se fia del patron: se comprueba de verdad con Intl. */
export function zonaValida(timezone) {
  if (typeof timezone !== 'string' || timezone.trim() === '') return false;

  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** 'YYYY-MM-DD' -> Date a medianoche UTC. */
export function parseDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date -> 'YYYY-MM-DD'. */
export function formatDateOnly(value) {
  if (!value) return null;

  const fecha = value instanceof Date ? value : new Date(value);

  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
}

/**
 * El "hoy" del negocio en su propia zona horaria.
 *
 * `hoyLocal()` de v1 usaba la zona del servidor, que es un error de reloj: la
 * agenda se lee con el calendario del navegador, que va en la zona de quien
 * mira. Aqui se resuelve con `en-CA`, cuyo formato es AAA-MM-DD (ISO), que es
 * justo lo que se quiere devolver sin tener que reconstruirlo a mano.
 */
export function hoyEn(timezone = 'UTC', ahora = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ahora);
  } catch {
    return hoyUtc(ahora);
  }
}

function hoyUtc(ahora) {
  return ahora.toISOString().slice(0, 10);
}

/** Alias de v1. Se mantiene para no romper a quien lo importaba. */
export const hoyLocal = hoyEn;

/** 'YYYY-MM-DD' + dias -> 'YYYY-MM-DD'. Sirve para rangos sin dealing con Date. */
export function sumarDias(fechaIso, dias) {
  const fecha = parseDateOnly(fechaIso);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Dias entre dos 'YYYY-MM-DD', inclusive el primero y el ultimo. */
export function diasEntre(desde, hasta) {
  const ms = parseDateOnly(hasta).getTime() - parseDateOnly(desde).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/** 0 = domingo ... 6 = sabado, en la zona del negocio. */
export function diaDeSemana(fechaIso, timezone = 'UTC') {
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    parseDateOnly(fechaIso)
  );

  const orden = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return orden[nombre] ?? parseDateOnly(fechaIso).getUTCDay();
}

/**
 * 'HH:MM' + minutos -> 'HH:MM'.
 *
 * `diasExtra` lleva la cuenta de si el resultado cae en otro dia. El generador de
 * agenda lo necesita: si una plantilla llega hasta las 23:30 y el bloque dura 60
 * minutos, el siguiente empieza a las 00:30 del dia SIGUIENTE, no del mismo, y sin
 * esto se publicarian veinte bloques amontonados en la medianoche.
 */
export function sumarMinutos(hora, minutos) {
  const [h, m] = hora.split(':').map(Number);
  const total = h * 60 + m + minutos;

  const diasExtra = Math.floor(total / 1440);
  const dentro = ((total % 1440) + 1440) % 1440;

  return {
    hora: `${String(Math.floor(dentro / 60)).padStart(2, '0')}:${String(dentro % 60).padStart(2, '0')}`,
    diasExtra,
  };
}

/** Minutos entre dos horas 'HH:MM'. */
export function minutosEntre(inicio, fin) {
  const [hi, mi] = inicio.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);
  return hf * 60 + mf - (hi * 60 + mi);
}

/**
 * 'YYYY-MM-DD' + 'HH:MM' + zona -> Date (instante real, en UTC).
 *
 * Se parte de la lectura en esa zona y se corrige por el desplazamiento real de ese
 * dia. El desplazamiento NO es fijo: cambia con el horario de verano, asi que hay que
 * calcularlo con Intl para la fecha concreta y no con una tabla de -03:00 fija.
 *
 * Sin esta correccion, una cita de las 21:00 en Montevideo (UTC-3) se guardaria como
 * las 21:00 UTC, que en hora local serian las 18:00: tres horas antes de lo que el
 * cliente ve en el calendario.
 */
export function instanteEn(fechaIso, hora, timezone = 'UTC') {
  const aprox = new Date(`${fechaIso}T${hora}:00.000Z`);

  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(aprox);

  const get = (tipo) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  /*
   * El desplazamiento se RESTA, y ese signo es lo unico facil de equivocar aqui.
   *
   * `desfase` es "cuanto se ha adelantado el reloj de la zona al leer este instante".
   * Si en Montevideo el reloj va tres horas atras, leer las 21:00 UTC da las 18:00, y
   * la diferencia es MENOS tres horas. Para volver de las 18:00 a las 21:00 hay que
   * avanzar el instante, no restar: por eso el signo va al reves de lo que parece.
   *
   * Comprobado con los dos sentidos:
   *   Montevideo (UTC-3): 21:00 local -> 00:00 UTC del dia siguiente
   *   Madrid invierno (UTC+1): 12:00 local -> 11:00 UTC (una hora ANTES)
   *   Madrid verano (UTC+2): 12:00 local -> 10:00 UTC (dos horas antes)
   *
   * Con el signo cambiado salia al reves en las tres, que es peor que estar roto:
   * un recordatorio a las 18:00 de una cita de las 21:00 parece funcionar.
   */
  const comoUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), 0);
  const desfase = comoUtc - aprox.getTime();

  return new Date(aprox.getTime() - desfase);
}

/** Un Date -> 'YYYY-MM-DD HH:MM' en la zona indicada, para el .ics y los correos. */
export function formatearEn(date, timezone = 'UTC', conHora = true) {
  const opciones = conHora
    ? {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }
    : { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' };

  const partes = new Intl.DateTimeFormat('en-CA', opciones).formatToParts(date);
  const get = (tipo) => partes.find((p) => p.type === tipo)?.value ?? '00';

  const fecha = `${get('year')}-${get('month')}-${get('day')}`;

  return conHora ? `${fecha} ${get('hour')}:${get('minute')}` : fecha;
}

export default {
  zonaValida,
  parseDateOnly,
  formatDateOnly,
  hoyEn,
  hoyLocal,
  sumarDias,
  diasEntre,
  diaDeSemana,
  sumarMinutos,
  minutosEntre,
  instanteEn,
  formatearEn,
};
