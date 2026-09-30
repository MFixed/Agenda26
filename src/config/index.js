import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const carpetaDatos = path.join(raiz, "data");

mkdirSync(carpetaDatos, { recursive: true });

/**
 * Secreto de firma del JWT.
 *
 * Si no viene por entorno se genera una sola vez y se guarda en
 * data/.jwt-secret, de forma que las sesiones sigan siendo válidas después de
 * reiniciar el servidor. En producción conviene fijarlo con JWT_SECRET.
 */
function resolverSecreto() {
  const delEntorno = process.env.JWT_SECRET && process.env.JWT_SECRET.trim();
  if (delEntorno) {
    return delEntorno;
  }
  const fichero = path.join(carpetaDatos, ".jwt-secret");
  if (existsSync(fichero)) {
    return readFileSync(fichero, "utf8").trim();
  }
  const secreto = randomBytes(48).toString("base64url");
  writeFileSync(fichero, secreto, { encoding: "utf8", mode: 0o600 });
  return secreto;
}

export const config = {
  raiz,
  carpetaViews: path.join(raiz, "public"),
  port: Number(process.env.PORT) || 3000,
  esProduccion: process.env.NODE_ENV === "production",
  jwt: {
    secreto: resolverSecreto(),
    // 8 horas: una jornada de trabajo sin dejar el token pegado en el navegador.
    expiraEnSegundos: 8 * 60 * 60,
    emisor: "gestion-citas"
  }
};
