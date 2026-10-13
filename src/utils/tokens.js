import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

/**
 * Emision y verificacion de JWT.
 *
 * v2 separa access token y refresh token, que es lo que faltaba en v1 para que
 * un panel de trabajo no expeliera a las 8 horas:
 *
 *  - Access token: 15 minutos, va en la cabecera Authorization, se usa para
 *    todo. Caduca pronto precisamente porque no se puede revocar.
 *  - Refresh token: 30 dias, se guarda hasheado en la base, sirve solo para
 *    pedir un access token nuevo. Se puede revocar (logout, cambio de
 *    contrasena, "cerrar sesion en todos los dispositivos"), que es lo que un
 *    JWT por si solo no puede hacer.
 *
 * El refresh rota en cada uso: cuando se gasta uno, se emite otro y el anterior
 * queda revocado. Si alguien roba un refresh token y lo usa, el token legitimo
 * del usuario deja de servir y ambos se pueden identificar. Es el patron de
 * deteccion de robo estandar y no cuesta nada aqui, porque la revocacion ya
 * existe.
 *
 * `ver` (tokenVersion) va dentro del access token: si el usuario cierra sesion o
 * cambia la contrasena, subir esa columna invalida todo lo emitido antes sin
 * necesidad de consultar una lista.
 */

export function firmarAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      biz: user.businessId ?? null,
      /// Version del token. Se compara contra la columna en cada peticion.
      ver: user.tokenVersion ?? 0,
      typ: 'access',
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, issuer: env.jwtIssuer, audience: env.jwtAudience }
  );
}

/**
 * Verifica un access token.
 *
 * Devuelve el payload o `null`. No lanza: el middleware decide que hacer con un
 * token malo, que siempre es lo mismo (401), y aqui no hace falta saber por que
 * fallo (caducado, mal firmado, corrupto) porque al cliente no se le dice.
 */
export function verificarAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    });

    /// Un refresh token firmado con la misma clave no vale como access token.
    /// Sin esta comprobacion, cambiar `aud` o `issuer` no protege nada: solo hay
    /// que mirar que el token sea del tipo correcto.
    return payload?.typ === 'access' ? payload : null;
  } catch {
    return null;
  }
}

export function duracionRefresh() {
  return {
    fecha: new Date(Date.now() + env.refreshExpiresDays * 86_400_000),
    /** Para la cabecera Expires-In, en segundos. */
    segundos: env.refreshExpiresDays * 86_400,
  };
}

export default { firmarAccessToken, verificarAccessToken, duracionRefresh };
