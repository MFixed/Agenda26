import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { AppError } from "./http.js";

/**
 * El token lleva lo justo para pintar la interfaz: quién es y con qué rol.
 *
 * El rol y el estado se vuelven a leer de la base de datos en cada petición
 * (ver middleware/auth.middleware.js), así que el token no es la única fuente de
 * autoridad y una baja surte efecto sin esperar a que caduque.
 */
export function firmarToken(usuario) {
  return jwt.sign({ rol: usuario.role }, config.jwt.secreto, {
    subject: String(usuario.id),
    issuer: config.jwt.emisor,
    expiresIn: config.jwt.expiraEnSegundos
  });
}

export function verificarToken(token) {
  try {
    return jwt.verify(token, config.jwt.secreto, { issuer: config.jwt.emisor });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, "La sesión ha caducado. Vuelve a iniciar sesión.");
    }
    throw new AppError(401, "La sesión no es válida.");
  }
}

/** Lee el token de la cabecera "Authorization: Bearer <token>". */
export function extraerToken(request) {
  const cabecera = request.get("authorization") || "";
  const [esquema, token] = cabecera.split(" ");
  if (!/^Bearer$/i.test(esquema) || !token) {
    throw new AppError(401, "Necesitas iniciar sesión para continuar.");
  }
  return token.trim();
}
