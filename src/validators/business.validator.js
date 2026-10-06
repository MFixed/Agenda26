import { anotar, cuerpoObjeto, emailNormalizado, esEmailValido, lanzarSiHayErrores, soloCampos, texto } from "./helpers.js";
import { validarPassword } from "./auth.validator.js";

/** POST /api/super/negocios — alta de un negocio con su primer administrador. */
export function parseNuevoNegocio(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, new Set(["nombre", "slug", "descripcion", "adminNombre", "adminEmail", "adminPassword"]), lista);

  const nombre = texto(datos.nombre);
  if (nombre.length < 2 || nombre.length > 120) {
    anotar(lista, "nombre", "El nombre del negocio debe tener entre 2 y 120 caracteres.");
  }

  const slug = texto(datos.slug).toLowerCase();
  if (slug && !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    anotar(lista, "slug", "El identificador sólo admite minúsculas, números y guiones.");
  }

  const descripcion = texto(datos.descripcion).slice(0, 240) || null;

  const adminNombre = texto(datos.adminNombre);
  if (adminNombre.length < 5 || adminNombre.length > 120) {
    anotar(lista, "adminNombre", "El nombre del administrador debe tener entre 5 y 120 caracteres.");
  }

  const adminEmail = emailNormalizado(datos.adminEmail);
  if (!adminEmail || !esEmailValido(adminEmail)) {
    anotar(lista, "adminEmail", "Introduce un correo válido para el administrador.");
  }

  const adminPassword = validarPassword(lista, datos.adminPassword, "adminPassword");

  lanzarSiHayErrores(lista, "Revisa los datos del negocio.");
  return { nombre, slug, descripcion, admin: { nombre: adminNombre, email: adminEmail, password: adminPassword } };
}

/** PATCH /api/super/negocios/:id — sólo activar/desactivar. */
export function parseEstadoNegocio(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, new Set(["activo"]), lista);
  if (typeof datos.activo !== "boolean") {
    anotar(lista, "activo", "Indica si el negocio queda activo (true) o desactivado (false).");
  }
  lanzarSiHayErrores(lista, "Revisa el cambio de estado.");
  return { activo: datos.activo };
}
