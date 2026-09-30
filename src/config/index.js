import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Estado de arranque: qué hay disponible y qué no. Se calcula una vez y lo
 * consultan /api/health y el arranque, para no repetir comprobaciones en tres
 * sitios.
 */
const avisos = [];

function avisar(mensaje) {
  avisos.push(mensaje);
  return mensaje;
}

/**
 * Carpeta de datos. Antes era un mkdirSync que se ejecutaba siempre y reventaba
 * el arranque entero si el disco no dejaba escribir. Que la aplicación no
 * arranque por no poder crear una carpeta es una forma estúpida de caerse.
 */
const carpetaDatos = path.join(raiz, "data");
let datosEscribible = false;
try {
  mkdirSync(carpetaDatos, { recursive: true });
  datosEscribible = true;
} catch (error) {
  avisar(`No se pudo crear la carpeta data/ (${error.code}). Los datos locales no se guardarán.`);
}

/**
 * Secreto de firma del JWT.
 *
 * Orden de preferencia:
 *   1. JWT_SECRET del entorno. Es lo único válido con más de una instancia, y es
 *      lo que hay que poner en Render.
 *   2. data/.jwt-secret, para no perder las sesiones al reiniciar en local.
 *   3. Uno generado en memoria. Funciona, pero caduca en cada despliegue: con
 *      este modo todo el mundo queda con la sesión cerrada tras cada reinicio.
 *
 * Nunca se lanza una excepción aquí. Un secreto que cambia es un contratiempo;
 * una aplicación que no arranca es una incidencia.
 */
function resolverSecreto() {
  const delEntorno = process.env.JWT_SECRET && process.env.JWT_SECRET.trim();
  if (delEntorno) {
    return delEntorno;
  }

  const fichero = path.join(carpetaDatos, ".jwt-secret");
  if (datosEscribible && existsSync(fichero)) {
    try {
      const guardado = readFileSync(fichero, "utf8").trim();
      if (guardado) {
        return guardado;
      }
    } catch {
      // Fichero ilegible: se ignora y se genera otro.
    }
  }

  const secreto = randomBytes(48).toString("base64url");
  if (datosEscribible) {
    try {
      writeFileSync(fichero, secreto, { encoding: "utf8", mode: 0o600 });
    } catch {
      avisar("No se pudo guardar data/.jwt-secret; el secreto cambiará en cada reinicio.");
    }
  }

  if (process.env.NODE_ENV === "production") {
    avisar(
      "JWT_SECRET no está definido. Se ha generado uno en memoria: todas las sesiones " +
        "quedarán cerradas en cada despliegue. Define JWT_SECRET en el panel de Render."
    );
  }

  return secreto;
}

const esProduccion = process.env.NODE_ENV === "production";
const urlBaseDatos = (process.env.DATABASE_URL || "").trim();

/**
 * Si no hay variable de entorno, Prisma puede tirar del fichero .env, que está
 * en el .gitignore y por tanto no viaja al despliegue. Sólo se avisa cuando no
 * hay ninguna de las dos fuentes: si el .env está, callarse es lo correcto.
 */
const hayFicheroEnv = existsSync(path.join(raiz, ".env"));

/**
 * URL efectiva a efectos de diagnóstico. Si la variable no está, se lee el .env,
 * que es lo que va a mirar Prisma. Sólo sirve para saber qué motor se usa y para
 * no avisar en falso: la conexión la decide Prisma al hacer la consulta.
 */
function urlDiagnosticable() {
  if (urlBaseDatos) {
    return urlBaseDatos;
  }
  if (!hayFicheroEnv) {
    return null;
  }
  const linea = readFileSync(path.join(raiz, ".env"), "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("DATABASE_URL"));
  if (!linea) {
    return null;
  }
  return (linea.split("=")[1] || "").trim().replace(/^["']|["']$/g, "");
}

const urlEfectiva = urlDiagnosticable();

/** El motor, tal cual se lo cuenta a quien mira /api/health. */
function motorDe(url) {
  if (url === null) {
    return "desconocido";
  }
  if (url.startsWith("file:")) {
    return "sqlite";
  }
  if (/^postgres(ql)?:\/\//.test(url)) {
    return "postgres";
  }
  return "otro";
}

export const config = {
  raiz,
  carpetaViews: path.join(raiz, "public"),
  carpetaDatos,
  datosEscribible,
  port: Number(process.env.PORT) || 3000,
  esProduccion,
  avisos,
  baseDeDatos: {
    // Null cuando no hay nada en ninguna de las dos fuentes. Es el fallo número
    // uno al desplegar: sin esto Prisma lanza al primer SELECT y la respuesta es
    // un 500 sin explicación.
    url: urlEfectiva,
    // Sólo para el diagnóstico de /api/health y para no avisar en falso. La
    // conexión la decide Prisma al hacer la consulta.
    motor: motorDe(urlEfectiva),
    esSQLite: urlEfectiva !== null && urlEfectiva.startsWith("file:"),
    definidaPorEntorno: Boolean(urlBaseDatos)
  },
  jwt: {
    secreto: resolverSecreto(),
    // 8 horas: una jornada de trabajo sin dejar el token pegado en el navegador.
    expiraEnSegundos: 8 * 60 * 60,
    emisor: "gestion-citas"
  }
};

if (!urlEfectiva) {
  avisar(
    "DATABASE_URL no está definida ni en el entorno ni en un .env. La base de datos no se " +
      "puede abrir: el login y el resto de la API responderán 503 explicando el motivo. " +
      "Defínela en el panel de Render."
  );
}
