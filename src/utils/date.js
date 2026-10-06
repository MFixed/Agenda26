/**
 * Convención de fechas de la aplicación.
 *
 * Regla única, para no mezclar formatos:
 *
 *   - Fechas sin hora (dueDate, Availability.date, Client.fechaNacimiento) se
 *     guardan como DateTime en MEDIANOCHE UTC. Así el mismo instante produce el
 *     mismo día sea cual sea la zona horaria del servidor, y la API puede
 *     devolverlas tal cual como "AAAA-MM-DD".
 *
 *   - Horas (startTime, endTime, dueTime) son cadenas "HH:mm". SQLite no tiene
 *     tipo hora y guardar una DateTime para "las 15:00" sería un artificial.
 *     Son hora local del negocio, sin zona.
 *
 *   - Marcas de tiempo (createdAt, updatedAt) son DateTime reales y la API las
 *     devuelve en ISO 8601 UTC.
 *
 * El frontend pinta DD/MM/YYYY y HH:mm, pero nunca recalcula nada: sólo
 * formatea lo que le llega.
 */

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** ¿"2026-09-30" es una fecha real? (descarta 2026-02-31) */
export function esFechaISO(valor) {
  if (typeof valor !== "string" || !RE_ISO.test(valor)) {
    return false;
  }
  const [anio, mes, dia] = valor.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  );
}

/** ¿"9:00" o "09:00"? */
export function esHora(valor) {
  return typeof valor === "string" && RE_HORA.test(valor);
}

/** "9:00" -> "09:00". Devuelve null si la hora no es válida. */
export function normalizarHora(valor) {
  if (typeof valor !== "string") {
    return null;
  }
  const coincidencia = RE_HORA.exec(valor.trim());
  if (!coincidencia) {
    return null;
  }
  return `${coincidencia[1].padStart(2, "0")}:${coincidencia[2]}`;
}

/** "AAAA-MM-DD" -> Date en medianoche UTC (lo que Prisma guarda). */
export function aMedianocheUTC(valor) {
  if (valor instanceof Date) {
    return valor;
  }
  if (!esFechaISO(valor)) {
    return null;
  }
  const [anio, mes, dia] = valor.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** Igual que aMedianocheUTC pero acepta vacío -> null (tarea sin fecha). */
export function fechaOpcional(valor) {
  if (valor === undefined || valor === null || valor === "") {
    return null;
  }
  return aMedianocheUTC(valor);
}

/** "AAAA-MM-DD" de hoy, según la zona del servidor. */
export function hoyISO() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

/** Fecha en "AAAA-MM-DD" dentro de N días a partir de hoy. */
export function hoyMasDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Primer y último día de un mes ("AAAA-MM") en "AAAA-MM-DD". */
export function limitesDelMes(mesISO) {
  if (!/^\d{4}-\d{2}$/.test(mesISO)) {
    return null;
  }
  const [anio, mes] = mesISO.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return {
    desde: `${mesISO}-01`,
    hasta: `${mesISO}-${String(ultimo).padStart(2, "0")}`
  };
}

/** Lunes de la semana que contiene la fecha (calendario semanal). */
export function inicioDeSemana(fechaISO) {
  const fecha = aMedianocheUTC(fechaISO);
  if (!fecha) {
    return null;
  }
  // getUTCDay() da 0 para domingo: retrocedemos hasta el lunes.
  const desplazamiento = (fecha.getUTCDay() + 6) % 7;
  fecha.setUTCDate(fecha.getUTCDate() - desplazamiento);
  return fecha.toISOString().slice(0, 10);
}

export function sumarDias(fechaISO, dias) {
  const fecha = aMedianocheUTC(fechaISO);
  if (!fecha) {
    return null;
  }
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Edad en años a día de hoy, o null si la fecha no es válida. */
export function edad(fechaISO) {
  const fecha = aMedianocheUTC(fechaISO);
  if (!fecha) {
    return null;
  }
  const hoy = new Date();
  let años = hoy.getUTCFullYear() - fecha.getUTCFullYear();
  const mes = hoy.getUTCMonth();
  const dia = hoy.getUTCDate();
  if (mes < fecha.getUTCMonth() || (mes === fecha.getUTCMonth() && dia < fecha.getUTCDate())) {
    años -= 1;
  }
  return años >= 0 ? años : null;
}

/** "2026-09-30" -> "30/09/2026" (para el texto de las notificaciones). */
export function formatearFechaES(fechaISO) {
  if (!esFechaISO(fechaISO)) {
    return "";
  }
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}

/** ¿"15:00" está antes que "16:00"? Compara strings, que es lo que guardamos. */
export function horaEsAnterior(primera, segunda) {
  return String(primera) < String(segunda);
}
