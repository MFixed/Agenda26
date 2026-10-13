import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/**
 * Hash de contrasenas con scrypt (modulo nativo de Node, sin dependencias).
 *
 * Formato: scrypt$<salt hex>$<hash hex>
 *
 * Por que scrypt y no bcrypt/argon2: scrypt viene en Node, con lo que no hay
 * dependencia nativa que compilar en el despliegue ni que auditar. Argon2 seria
 * mejor en teoria, pero anadir una extension nativa por esto no compensa.
 *
 * Los parametros (N=16384, r=8, p=1) son los que usa Node por defecto cuando no
 * se le pasan. Subirlos haria el login mas lento y mas seguro; bajarlos dejaria
 * el hash a la vista de un ataque de GPU. Se dejan como estan y se documenta
 * que subirlos obliga a migrar los hashes existentes al primer login.
 */

const KEY_LENGTH = 64;

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifica una contrasena contra un hash guardado.
 *
 * Nunca lanza: si el hash guardado esta corrupto o usa un esquema que esta
 * version ya no entiende, devuelve false. Un error aqui significa "esa
 * contrasena no es la correcta", que es la unica respuesta que el login sabe
 * dar sin filtrar informacion.
 */
export async function verifyPassword(plain, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');

    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length);

    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Fuerza de una contrasena, para poder pedirle al usuario que la mejore.
 *
 * No decide nada: solo informa. Rechazar contrasenas por unaminidad de reglas
 * empuja a la gente a "Password1!", que es peor que una contrasena un poco
 * mas corta y con una frase.
 */
export function fuerzaPassword(password) {
  let puntos = 0;

  if (password.length >= 8) puntos += 1;
  if (password.length >= 12) puntos += 1;
  if (/[a-z]/.test(password)) puntos += 1;
  if (/[A-Z]/.test(password)) puntos += 1;
  if (/\d/.test(password)) puntos += 1;
  if (/[^A-Za-z0-9]/.test(password)) puntos += 1;

  if (/^[a-z]+$/.test(password) || /^\d+$/.test(password)) puntos -= 1;

  const nivel = puntos <= 2 ? 'debil' : puntos <= 4 ? 'media' : 'fuerte';

  return { puntos: Math.max(puntos, 0), nivel };
}

export default { hashPassword, verifyPassword, fuerzaPassword };
