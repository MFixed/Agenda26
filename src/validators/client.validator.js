import {
  anotar,
  cuerpoObjeto,
  emailNormalizado,
  esEmailValido,
  fechaISOoLista,
  idPositivo,
  lanzarSiHayErrores,
  opcional,
  soloCampos,
  texto
} from "./helpers.js";
import { validarDocumento, validarDireccion, validarNacimiento, validarNombre, validarPassword, validarTelefono } from "./auth.validator.js";

const CAMPOS = new Set([
  "nombre",
  "email",
  "password",
  "documento",
  "fechaNacimiento",
  "telefono",
  "direccion",
  "activo"
]);

/**
 * POST /api/clients — alta manual desde el panel.
 * Si no se manda contraseña se genera una temporal que se devuelve una sola vez
 * (ver client.service.js).
 */
export function parseNuevoCliente(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, CAMPOS, lista);

  const nombre = validarNombre(lista, datos.nombre);
  const email = emailNormalizado(datos.email);
  if (!email) {
    anotar(lista, "email", "Introduce un correo electrónico.");
  } else if (!esEmailValido(email)) {
    anotar(lista, "email", "Usa un correo electrónico válido.");
  }
  const password = datos.password ? validarPassword(lista, datos.password) : "";
  const documento = validarDocumento(lista, datos.documento, { requerido: true });
  const fechaNacimiento = validarNacimiento(lista, datos.fechaNacimiento, { requerido: true });
  const telefono = validarTelefono(lista, datos.telefono);
  const direccion = validarDireccion(lista, datos.direccion);

  lanzarSiHayErrores(lista, "Revisa los datos del cliente.");
  return { nombre, email, password, documento, fechaNacimiento, telefono, direccion, activo: true };
}

/**
 * PUT /api/clients/:id — el administrador corrige la ficha y la cuenta.
 * Los campos que no vienen se dejan como están (no se borran por omitirlos).
 */
export function parseActualizarCliente(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, CAMPOS, lista);

  const nombre = validarNombre(lista, datos.nombre);
  const email = emailNormalizado(datos.email);
  if (!email) {
    anotar(lista, "email", "Introduce un correo electrónico.");
  } else if (!esEmailValido(email)) {
    anotar(lista, "email", "Usa un correo electrónico válido.");
  }
  const password = datos.password ? validarPassword(lista, datos.password) : "";
  const documento = validarDocumento(lista, datos.documento, { requerido: true });
  const fechaNacimiento = validarNacimiento(lista, datos.fechaNacimiento, { requerido: true });
  const telefono = validarTelefono(lista, datos.telefono);
  const direccion = validarDireccion(lista, datos.direccion);
  const activo = datos.activo === undefined ? undefined : Boolean(datos.activo);

  lanzarSiHayErrores(lista, "Revisa los datos del cliente.");
  return { nombre, email, password, documento, fechaNacimiento, telefono, direccion, activo };
}

export { idPositivo, opcional, fechaISOoLista, texto };
