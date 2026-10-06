import { PrismaClient } from "@prisma/client";
import { config } from "./index.js";

/**
 * Cliente de Prisma compartido.
 *
 * Una sola instancia en todo el proceso: Prisma gestiona internamente el pool de
 * conexiones, y abrir varias dejaría conexiones abiertas de sobra.
 *
 * Ojo con no pasarle `datasources`: la URL se comprueba en diagnostico(), que es
 * donde se explica el problema, en lugar de dejar que reviente en la primera
 * petición con un 500 sin pistas.
 */
export const prisma = new PrismaClient();

/**
 * Transacción interactiva con margen para bases de datos remotas.
 *
 * Prisma corta las transacciones interactivas a los 5 segundos por defecto, y
 * ese valor se calibró con SQLite en local, donde cada consulta es una llamada a
 * un fichero. Contra PostgreSQL en otra máquina cada consulta es un viaje de ida
 * y vuelta, y una transacción que bloquea un hueco se pasa de los 5 segundos:
 * P2028, con la operación a medias.
 *
 * Con SQLite local no se notaba. Se notó la primera vez que se ejecutó el flujo
 * de reservas contra la base de datos de Render, en Oregón.
 *
 * 20 segundos es holgado para las transacciones que hay aquí —ninguna hace más
 * de seis consultas— y sigue siendo un tope: si algo se cuelga de verdad, para.
 */
export async function enTransaccion(funcion, { timeout = 20000, maxWait = 10000 } = {}) {
  return prisma.$transaction(funcion, { timeout, maxWait });
}

/** Se leen así los errores de Prisma: "The table main.User does not exist". */
const ES_FALTA_TABLA = /^P2021$/;
const ES_SIN_VARIABLE = /environment variable not found|resolved to an empty string/i;
const ES_ERROR_DE_CONEXION =
  /unable to open the database|ECONNREFUSED|password authentication|server has closed the connection|can't reach database|host not found|ENOTFOUND/i;

/**
 * Une los mensajes de Prisma con algo que se pueda arreglar.
 *
 * Sin esto, un despliegue nuevo en Render sin DATABASE_URL defined
 * respondía "Error interno del servidor." a todo, sin decir una palabra de por
 * qué. Quien no conoce el proyecto no tiene forma de adivinar que el problema
 * era una variable de entorno.
 *
 * OJO: aquí no se comprueba process.env.DATABASE_URL antes de consultar, porque
 * Prisma carga el fichero .env por su cuenta. En local la base abre sin que la
 * variable esté en el entorno, y un chequeo basado sólo en process.env daría un
 * falso negativo: diría que no hay base de datos teniéndola. La verdad la cuenta
 * Prisma al ejecutar la consulta.
 *
 * @returns {{ ok: true, usuarios: number, motor: string }
 *         | { ok: false, problema: string, comoSeArregla: string, detalle?: string }}
 */
export async function diagnostico() {
  try {
    // Una consulta de verdad contra una tabla real: si la base abre pero está
    // vacía, esto falla y el diagnóstico lo distingue de "no se puede abrir".
    const usuarios = await prisma.user.count();
    return { ok: true, usuarios, motor: config.baseDeDatos.motor };
  } catch (error) {
    const codigo = String(error?.code || "");
    const texto = String(error?.message || "");

    if (ES_FALTA_TABLA.test(codigo)) {
      return {
        ok: false,
        problema: "La base de datos está vacía: faltan las tablas.",
        comoSeArregla: "Aplica las migraciones en el arranque: npx prisma migrate deploy"
      };
    }

    if (ES_SIN_VARIABLE.test(texto)) {
      return {
        ok: false,
        problema: "Falta la variable de entorno DATABASE_URL.",
        detalle: resumen(error),
        comoSeArregla:
          "Defínela en el panel de Render. Con disco montado: file:/opt/render/project/src/data/agenda.db"
      };
    }

    if (error?.name === "PrismaClientInitializationError" || ES_ERROR_DE_CONEXION.test(texto)) {
      return {
        ok: false,
        problema: "No se puede abrir la base de datos.",
        detalle: resumen(error),
        comoSeArregla: "Revisa que DATABASE_URL sea correcta y que el disco esté montado."
      };
    }

    return {
      ok: false,
      problema: "Error inesperado al leer la base de datos.",
      detalle: resumen(error),
      comoSeArregla: "Mira el registro del servidor para el error completo."
    };
  }
}

/** Una sola línea: los mensajes de Prisma vienen con el esquema entero pegado. */
function resumen(error) {
  return String(error?.message || "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea && !linea.startsWith("-->") && !linea.startsWith("|"))
    .slice(0, 2)
    .join(" · ")
    .slice(0, 220);
}
