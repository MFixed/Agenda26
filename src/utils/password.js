import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * Hash de contraseñas con scrypt (incluido en Node; sin bcrypt ni argon2).
 *
 * Los parámetros se guardan dentro de la propia cadena, así que subir el coste
 * en el futuro no invalida las contraseñas ya guardadas: al verificar se leen de
 * la cadena en lugar de usar los de este módulo.
 */
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return [
    "scrypt",
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString("base64url"),
    derivedKey.toString("base64url")
  ].join("$");
}

export async function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, cost, blockSize, parallelization, saltPart, hashPart] =
      String(encodedHash).split("$");
    const salt = Buffer.from(saltPart || "", "base64url");
    const expectedHash = Buffer.from(hashPart || "", "base64url");

    // Rangos acotados: un hash manipulado no debe poder pedir 2^30 de memoria y
    // tumbar el servidor.
    if (
      algorithm !== "scrypt" ||
      !Number.isSafeInteger(Number(cost)) || Number(cost) < 16384 || Number(cost) > 1048576 ||
      !Number.isSafeInteger(Number(blockSize)) || Number(blockSize) < 1 || Number(blockSize) > 32 ||
      !Number.isSafeInteger(Number(parallelization)) || Number(parallelization) < 1 || Number(parallelization) > 16 ||
      salt.length < 16 ||
      expectedHash.length < 32 || expectedHash.length > 128
    ) {
      return false;
    }

    const actualHash = await scrypt(password, salt, expectedHash.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
      maxmem: SCRYPT_OPTIONS.maxmem
    });
    return timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
}

/** Compara en tiempo constante, para no filtrar información por temporización. */
export function constantTimeEquals(izquierda, derecha) {
  const a = Buffer.from(String(izquierda));
  const b = Buffer.from(String(derecha));
  return a.length === b.length && timingSafeEqual(a, b);
}
