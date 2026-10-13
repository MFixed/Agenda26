import { randomBytes } from 'node:crypto';
import { prisma } from '../../../../config/driver.js';
import { hashToken } from '../../../../config/logger.js';
import { env } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { ApiError } from '../../../utils/ApiError.js';
import { hashPassword } from '../../../utils/password.js';
import { auditar } from '../../../utils/audit.js';
import { correoRecuperacion } from './recovery-email.js';

/**
 * Recuperacion de contrasena.
 *
 * Es lo que en v1 no existia y hacia falta: la unica forma de recuperar el acceso
 * a una cuenta era que un administrador reasignara la contrasena desde el CRUD.
 *
 * Dos decisiones que no son accidentales:
 *
 *  1. **La respuesta es siempre la misma**, exista o no el correo. Si el endpoint
 *     dijera "no hay ninguna cuenta con ese correo", se convierte en un
 *     comprobador de correos registered. Se responde 200 y punto.
 *
 *  2. **El token se guarda hasheado y es de un solo uso.** Si alguien lee la
 *     tabla no puede resetear la contrasena de nadie, y un enlace reenviado dos
 *     veces solo vale la primera.
 *
 * A diferencia del resto del envio de correo, aqui SI se espera al resultado:
 * si el correo no sale, el usuario se queda esperando un enlace que no existe y
 * no hay forma de que se entere. Se registra el fallo en vez de tragarselo.
 */
export async function forgot(email) {
  const normalizado = email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizado },
    select: { id: true, email: true, nombre: true, activo: true, deletedAt: true },
  });

  if (!user || !user.activo || user.deletedAt) {
    logger.warn('recuperacion pedida para un email desconocido', { email: normalizado });

    /// Se responde igual de todas formas: decir "no existe" confirma al atacante
    /// que el correo no esta registrado.
    return { mensaje: 'Si el correo esta registrado, te enviamos un enlace para restablecer la contrasena.' };
  }

  /// Los tokens anteriores de este usuario se invalidan: pedir la recuperacion
  /// dos veces no debe dejar dos enlaces vivos, solo el ultimo.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const enClaro = randomBytes(32).toString('base64url');

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(enClaro),
      expiresAt: new Date(Date.now() + env.passwordResetExpiresMin * 60_000),
      requestedEmail: user.email,
    },
  });

  const enlace = `${env.appUrl}/reset-password?token=${encodeURIComponent(enClaro)}`;

  const { enviado, motivo } = await correoRecuperacion({ user, enlace });

  if (!enviado) {
    logger.error('no se pudo enviar el correo de recuperacion', { email: user.email, motivo });
  }

  auditar({ actorId: user.id, action: 'password_forgot', entity: 'User', entityId: user.id });

  return { mensaje: 'Si el correo esta registrado, te enviamos un enlace para restablecer la contrasena.' };
}

/**
 * Consume el token y pone la contrasena nueva.
 *
 * Revoca ademas todas las sesiones: si el robo era el motivo del reset, dejar las
 * sesiones vivas haria el reset inutil.
 */
export async function reset({ token, password }, req) {
  const tokenHash = hashToken(token);

  const guardado = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, activo: true, deletedAt: true } } },
  });

  const invalido =
    !guardado ||
    guardado.usedAt ||
    guardado.expiresAt < new Date() ||
    !guardado.user.activo ||
    guardado.user.deletedAt;

  if (invalido) {
    /// El mismo mensaje para "no existe", "caducado" y "ya usado": un atacante
    /// probando tokens no puede distinguir cual de los tres fallo.
    throw ApiError.badRequest('El enlace no es valido o ha caducado. Pide uno nuevo.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: guardado.userId },
      data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({ where: { id: guardado.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({
      where: { userId: guardado.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  auditar({
    actorId: guardado.userId,
    action: 'password_reset',
    entity: 'User',
    entityId: guardado.userId,
    req,
  });

  return { mensaje: 'Contrasena restablecida. Ya puedes entrar con la nueva.' };
}

export default { forgot, reset };
