import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/**
 * Hash de contrasenas con scrypt (modulo nativo de Node, sin dependencias).
 * Formato: scrypt$<salt hex>$<hash hex>
 */

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');

  if (scheme !== 'scrypt' || !saltHex || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length);

  return timingSafeEqual(expected, actual);
}