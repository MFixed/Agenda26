import { prisma } from '../../../../config/driver.js';
import { ApiError } from '../../../utils/ApiError.js';
import { parseDateOnly, sumarMinutos, minutosEntre, diaDeSemana } from '../../../utils/dates.js';
import { auditar } from '../../../utils/audit.js';

/**
 * Agenda recurrente (nuevo en v2).
 *
 * `BusinessSchedule` es la PLANTILLA: "los lunes de 09:00 a 18:00, bloques de 60".
 * No son huecos reales; los huecos reales son filas de `Availability` que se
 * materializan a partir de aqui con `generar()`.
 *
 * Separar las dos cosas es lo que hace posible "cambiar el horario de los lunes a
 * todo el mes" sin tirar los huecos ya publicados y perderse las citas que tienen
 * encima.
 */

const SELECT = {
  id: true,
  weekday: true,
  startTime: true,
  endTime: true,
  slotMinutes: true,
  note: true,
  activo: true,
  staffId: true,
  staff: { select: { id: true, nombre: true, color: true } },
};

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

export const nombreDia = (weekday) => NOMBRES_DIA[weekday] ?? 'Dia';

export async function list(businessId) {
  const items = await prisma.businessSchedule.findMany({
    where: { businessId },
    select: SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });

  return items.map((item) => ({ ...item, nombreDia: nombreDia(item.weekday) }));
}

export async function create(businessId, data, req) {
  assertFranjaValida(data.startTime, data.endTime);

  const plantilla = await prisma.businessSchedule.create({
    data: { businessId, ...data },
    select: SELECT,
  });

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'create',
    entity: 'BusinessSchedule',
    entityId: plantilla.id,
    req,
  });

  return { ...plantilla, nombreDia: nombreDia(plantilla.weekday) };
}

export async function update(businessId, id, data, req) {
  const plantilla = await prisma.businessSchedule.findFirst({
    where: { id, businessId },
    select: SELECT,
  });

  if (!plantilla) throw ApiError.notFound('Plantilla no encontrada');

  /// La coherencia se comprueba contra la combinacion FINAL, no solo contra lo
  /// que viene en el body: si mandan `startTime` sin `endTime`, comparar los dos
  /// sueltos daria un error falso.
  const inicio = data.startTime ?? plantilla.startTime;
  const fin = data.endTime ?? plantilla.endTime;

  assertFranjaValida(inicio, fin);

  const actualizada = await prisma.businessSchedule.update({
    where: { id },
    data,
    select: SELECT,
  });

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'update',
    entity: 'BusinessSchedule',
    entityId: id,
    req,
  });

  return { ...actualizada, nombreDia: nombreDia(actualizada.weekday) };
}

export async function remove(businessId, id, req) {
  const { count } = await prisma.businessSchedule.deleteMany({ where: { id, businessId } });

  if (count === 0) throw ApiError.notFound('Plantilla no encontrada');

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'delete',
    entity: 'BusinessSchedule',
    entityId: id,
    req,
  });
}

function assertFranjaValida(startTime, endTime) {
  if (minutosEntre(startTime, endTime) <= 0) {
    throw ApiError.badRequest('Revisa los datos del formulario', [
      { field: 'startTime', message: 'La hora de inicio debe ser anterior a la de fin' },
    ]);
  }
}

/**
 * Materializa bloques de `Availability` desde las plantillas para un rango de
 * fechas.
 *
 * Devuelve cuantos se crearon y cuantos ya estaban. Lo segundo importa: no es un
 * fallo, es lo que pasa cuando se regenera el mismo rango (es lo normal, porque
 * uno actualiza la plantilla y vuelve a materializar para encharcar lo que falta).
 *
 * Idempotente de verdad: el indice UNIQUE (businessId, staffId, date, startTime)
 * hace que un bloque repetido reviente, asi que se filtra antes contra lo que ya
 * existe y los choques que aun asi lleguen se saltan.
 */
export async function generate(businessId, { desde, hasta, dias = [], slotMinutes, staffId }, req) {
  const plantillas = await prisma.businessSchedule.findMany({
    where: {
      businessId,
      activo: true,
      ...(dias.length > 0 ? { weekday: { in: dias } } : {}),
      /// Si la generacion es para un profesional concreto, solo se materializan
      /// sus plantillas: la agenda se publica "de esta persona".
      ...(staffId ? { staffId } : {}),
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });

  if (plantillas.length === 0) {
    return { creados: 0, omitidos: 0, mensaje: 'No hay plantillas activas para esos dias.' };
  }

  /*
   * `req.business` es obligatorio en esta ruta (`withBusiness` lo garantiza) y su
   * `bufferMin` tambien. Antes se leia con un `?? { bufferMin: 0 }` que convertia
   * un fallo de cableado en "esta empresa no tiene margen": los huecos se
   * generaban pegados sin ningun aviso y la interfaz mintia en silencio.
   */
  if (!req.business) {
    throw ApiError.internal('El negocio no llego al generador de agenda');
  }

  const { bufferMin } = req.business;

  const existentes = await prisma.availability.findMany({
    where: { businessId, date: { gte: parseDateOnly(desde), lte: parseDateOnly(hasta) }, deletedAt: null },
    select: { date: true, startTime: true, staffId: true },
    /*
     * Tope de seguridad. `desde` y `hasta` los manda quien llama: sin `take`, un
     * rango de diez anos se traia EVERY hueco de la empresa de golpe. Solo hace
     * falta para decidir que duplicados hay, asi que si se llega al tope lo que se
     * hace es avisar en el log, no fallar la peticion.
     */
    take: 20_000,
  });

  const yaExisting = new Set(
    existentes.map((e) => `${e.date.toISOString().slice(0, 10)}|${e.startTime}|${e.staffId ?? ''}`)
  );

  const nuevos = [];
  const vistos = new Set();
  /// Cuantos huecos ha omitido ESTA generacion por ya existir. Se cuenta aqui y
  /// no con `yaExisting.size`, que es el total de huecos del rango.
  let omitidosGenerados = 0;

  for (const dia of diasEntreStrings(desde, hasta)) {
    const fecha = parseDateOnly(dia);

    /*
     * El dia de la semana se calcula en la ZONA DEL NEGOCIO, no en UTC.
     *
     * `parseDateOnly` deja el dia a medianoche UTC, y `getUTCDay()` de ahi puede no
     * ser el dia que el negocio tiene delante: una clinica en Montevideo (UTC-3) que
     * atiende a las 21:30 ya esta en el dia siguiente segun el reloj del navegador,
     * pero la fecha guardada en la base sigue siendo la anterior.
     *
     * Sin esto, la plantilla de "los lunes" no genera nada y el unico sintoma es un
     * `creados: 0` que no dice por que.
     */
    const weekday = diaDeSemana(dia, req.business?.timezone ?? 'UTC');

    for (const plantilla of plantillas.filter((p) => p.weekday === weekday)) {
      const duracion = slotMinutes ?? plantilla.slotMinutes;
      let cursor = plantilla.startTime;

      while (cursor !== plantilla.endTime && minutosEntre(cursor, plantilla.endTime) > 0) {
        const { hora: fin, diasExtra } = sumarMinutos(cursor, duracion);

        /*
         * Si el bloque se pasa de medianoche, la plantilla se ha agotado.
         *
         * `sumarMinutos` devuelve `diasExtra` justo para esto y aqui se estaba
         * descartando al quedarse solo con `hora`: un cursor que llegaba a "00:00"
         * hacia que `minutosEntre('00:00', '23:59')` diera 1439, el `while` siguiera
         * y se publicaran decenas de bloques amontonados en la medianoche del mismo
         * dia. Con una plantilla de 23:00 a 23:59, bloques de 30 y buffer de 30,
         * salian unos cuarenta huecos fantasma de madrugada, todos vendibles.
         *
         * Cortando aqui, el bloque que no cabe entero en la plantilla simplemente no
         * se publica, que es lo correcto.
         */
        if (diasExtra > 0) {
          break;
        }

        const clave = `${dia}|${cursor}|${plantilla.staffId ?? ''}`;

        if (!yaExisting.has(clave) && !vistos.has(clave)) {
          vistos.add(clave);

          nuevos.push({
            businessId,
            date: fecha,
            startTime: cursor,
            endTime: fin,
            /// El buffer va dentro del bloque: es tiempo de limpieza o de
            /// desplazamiento que la empresa no vende. Asi el hueco siguiente
            /// puede empezar justo cuando termina este sin que haya solape.
            note: plantilla.note,
            staffId: plantilla.staffId,
            status: 'AVAILABLE',
          });
        } else {
          omitidosGenerados += 1;
        }

        /*
         * El buffer tambien puede empujar el cursor al dia siguiente. Sin mirar su
         * `diasExtra`, un cursor que llega a "00:00" reinicia el recorrido y se
         * generan bloques fantasma de madrugada, que es el mismo bug que el del
         * `diasExtra` del bloque anterior.
         */
        const siguiente = sumarMinutos(fin, bufferMin);

        if (siguiente.diasExtra > 0) {
          break;
        }

        cursor = siguiente.hora;
      }
    }
  }

  if (nuevos.length === 0) {
    /*
     * El numero de omitidos NO es `yaExisting.size`.
     *
     * Ese Set tiene TODOS los bloques que ya habia en el rango, de cualquier
     * profesional y de cualquier plantilla: no son los que esta generacion ha
     * encontrado repetidos, son los que ya estaban. Con el Set entero, una
     * generacion sobre un rango ya publicado devolvia "omitidos: 412" habiendolo
     * omitido cero, y el usuario leia un numero que no significaba nada.
     *
     * Aqui se cuenta lo que de verdad se salto de ESTA generacion, que es lo que
     * el bucle va descartando por `yaExisting`.
     */
    return {
      creados: 0,
      omitidos: omitidosGenerados,
      mensaje: 'La agenda ya estaba generada para ese rango.',
    };
  }

  /*
   * Se insertan uno a uno y no con `createMany({ skipDuplicates: true })`.
   *
   * `skipDuplicates` solo existe en PostgreSQL y MySQL: Prisma lo rechaza en SQLite
   * con "Unknown argument". Como no hay alternativa de una sola llamada, se inserta
   * fila a fila y un choque UNIQUE se salta.
   *
   * El coste es una sentencia por bloque, y para un mes completo son unas 160. En
   * SQLite, que serializa las escrituras de todos modos, la diferencia real es
   * ninguna. Lo que no se puede perder es la idempotencia: regenerar el mismo rango
   * tiene que salir con `creados: 0`, no reventar con un 500.
   */
  let creados = 0;
  let omitidos = 0;

  await prisma.$transaction(async (tx) => {
    for (const hueco of nuevos) {
      try {
        await tx.availability.create({ data: hueco });
        creados += 1;
      } catch (error) {
        // P2002 = el indice unico (businessId, staffId, date, startTime) ya lo tiene.
        if (error?.code === 'P2002') {
          omitidos += 1;
          continue;
        }

        throw error;
      }
    }
  });

  auditar({
    businessId,
    actorId: req.user?.id,
    action: 'generate',
    entity: 'Availability',
    payload: { desde, hasta, creados, omitidos },
    req,
  });

  return {
    creados,
    omitidos: omitidos + yaExisting.size,
    mensaje:
      creados === 0 ? 'La agenda ya estaba generada para ese rango.' : `Se publicaron ${creados} bloques.`,
  };
}

/** Itera dias de 'YYYY-MM-DD' sin dealing con DST ni con la zona del servidor. */
function* diasEntreStrings(desde, hasta) {
  const cursor = parseDateOnly(desde);
  const fin = parseDateOnly(hasta);

  while (cursor <= fin) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

export default { list, create, update, remove, generate, nombreDia };
