import {
  anotar,
  cuerpoObjeto,
  emailNormalizado,
  esEmailValido,
  fechaISOoLista,
  horaValida,
  idPositivo,
  lanzarSiHayErrores,
  opcional,
  soloCampos,
  texto
} from "./helpers.js";
import { edad, hoyISO } from "../utils/date.js";

const RE_DOCUMENTO = /^[A-Z0-9][A-Z0-9.\-]{3,29}$/;
const RE_TELEFONO = /^[0-9]{7,15}$/;

/* ------------------------------------------------------------------ *
 * Campos de ficha, compartidos por el registro y el perfil
 * ------------------------------------------------------------------ */

export function validarNombre(lista, valor, campo = "nombre") {
  const nombre = texto(valor).replace(/\s+/g, " ");
  if (nombre.length < 5 || nombre.length > 120) {
    anotar(lista, campo, "El nombre debe tener entre 5 y 120 caracteres.");
  } else if (nombre.split(" ").filter(Boolean).length < 2) {
    anotar(lista, campo, "Escribe el nombre y los apellidos.");
  }
  return nombre;
}

export function validarDocumento(lista, valor, { requerido = false } = {}) {
  const documento = texto(valor).replace(/\s+/g, "").toUpperCase();
  if (!documento) {
    if (requerido) {
      anotar(lista, "documento", "Indica el número de documento.");
    }
    return null;
  }
  if (!RE_DOCUMENTO.test(documento)) {
    anotar(
      lista,
      "documento",
      "El documento solo admite letras, números, punto y guion (4 a 30 caracteres)."
    );
  }
  return documento;
}

export function validarNacimiento(lista, valor, { requerido = false } = {}) {
  const fecha = fechaISOoLista(lista, "fechaNacimiento", valor, { requerido });
  if (!fecha) {
    return null;
  }
  if (fecha > hoyISO()) {
    anotar(lista, "fechaNacimiento", "La fecha de nacimiento no puede ser futura.");
    return null;
  }
  const años = edad(fecha);
  if (años !== null && años > 120) {
    anotar(lista, "fechaNacimiento", "Revisa la fecha de nacimiento: supera los 120 años.");
    return null;
  }
  return fecha;
}

export function validarTelefono(lista, valor) {
  const telefono = opcional(valor);
  if (!telefono) {
    return null;
  }
  if (telefono.length > 40 || !RE_TELEFONO.test(telefono.replace(/\D/g, ""))) {
    anotar(lista, "telefono", "El teléfono debe tener entre 7 y 15 dígitos.");
    return null;
  }
  return telefono;
}

export function validarDireccion(lista, valor) {
  const direccion = opcional(valor);
  if (direccion && direccion.length > 240) {
    anotar(lista, "direccion", "La dirección es demasiado larga (240 caracteres máximo).");
  }
  return direccion;
}

export function validarEmail(lista, valor) {
  const email = emailNormalizado(valor);
  if (!email) {
    anotar(lista, "email", "Introduce un correo electrónico.");
  } else if (!esEmailValido(email)) {
    anotar(lista, "email", "Usa un correo electrónico válido.");
  }
  return email;
}

export function validarPassword(lista, valor, campo = "password") {
  const password = typeof valor === "string" ? valor : "";
  if (password.length < 8) {
    anotar(lista, campo, "La contraseña debe tener al menos 8 caracteres.");
  } else if (password.length > 128) {
    anotar(lista, campo, "La contraseña es demasiado larga (128 caracteres máximo).");
  } else if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(password) || !/\d/.test(password)) {
    anotar(lista, campo, "Combina letras y números.");
  }
  return password;
}

/* ------------------------------------------------------------------ *
 * Peticiones
 * ------------------------------------------------------------------ */

/**
 * POST /api/auth/register
 * El rol no se acepta nunca desde aquí: un cliente no puede pedir ser admin.
 * `negocio` es el slug del negocio al que se suma el cliente.
 */
export function parseRegistro(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(
    datos,
    new Set([
      "nombre",
      "email",
      "password",
      "confirmPassword",
      "documento",
      "fechaNacimiento",
      "telefono",
      "direccion",
      "negocio"
    ]),
    lista
  );

  const nombre = validarNombre(lista, datos.nombre);
  const email = validarEmail(lista, datos.email);
  const password = validarPassword(lista, datos.password);
  const documento = validarDocumento(lista, datos.documento, { requerido: true });
  const fechaNacimiento = validarNacimiento(lista, datos.fechaNacimiento, { requerido: true });
  const telefono = validarTelefono(lista, datos.telefono);
  const direccion = validarDireccion(lista, datos.direccion);
  const negocio = texto(datos.negocio).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(negocio)) {
    anotar(lista, "negocio", "Indica el negocio al que quieres sumarte.");
  }

  if (typeof datos.confirmPassword !== "string" || datos.confirmPassword !== password) {
    anotar(lista, "confirmPassword", "Las contraseñas no coinciden.");
  }

  lanzarSiHayErrores(lista, "Revisa los datos de registro.");
  return { nombre, email, password, documento, fechaNacimiento, telefono, direccion, negocio };
}

/** POST /api/auth/login
 * `negocio` es el slug del negocio; sólo el superadministrador puede omitirlo. */
export function parseLogin(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, new Set(["email", "password", "negocio"]), lista);

  const email = emailNormalizado(datos.email);
  if (!email) {
    anotar(lista, "email", "Introduce un correo electrónico.");
  } else if (!esEmailValido(email)) {
    anotar(lista, "email", "Usa un correo electrónico válido.");
  }
  if (typeof datos.password !== "string" || datos.password.length === 0) {
    anotar(lista, "password", "Introduce la contraseña.");
  } else if (datos.password.length > 128) {
    anotar(lista, "password", "La contraseña es demasiado larga.");
  }
  const negocio = texto(datos.negocio).toLowerCase();
  if (negocio && !/^[a-z0-9][a-z0-9-]{1,60}$/.test(negocio)) {
    anotar(lista, "negocio", "El código de negocio no es válido.");
  }

  lanzarSiHayErrores(lista, "Revisa los datos de acceso.");
  return { email, password: datos.password, negocio };
}

/**
 * PUT /api/clients/me — el cliente corrige su propia ficha.
 * El email y la contraseña se cambian, pero el rol y el estado no se tocan.
 */
export function parsePerfilPropio(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(
    datos,
    new Set([
      "nombre",
      "email",
      "documento",
      "fechaNacimiento",
      "telefono",
      "direccion",
      "passwordActual",
      "passwordNueva"
    ]),
    lista
  );

  const nombre = validarNombre(lista, datos.nombre);
  const email = validarEmail(lista, datos.email);
  const documento = validarDocumento(lista, datos.documento, { requerido: true });
  const fechaNacimiento = validarNacimiento(lista, datos.fechaNacimiento, { requerido: true });
  const telefono = validarTelefono(lista, datos.telefono);
  const direccion = validarDireccion(lista, datos.direccion);

  let passwordNueva = null;
  if (datos.passwordNueva) {
    if (!datos.passwordActual) {
      anotar(lista, "passwordActual", "Introduce tu contraseña actual para cambiar la contraseña.");
    }
    passwordNueva = validarPassword(lista, datos.passwordNueva, "passwordNueva");
  }

  lanzarSiHayErrores(lista, "Revisa los datos del perfil.");
  return {
    nombre,
    email,
    documento,
    fechaNacimiento,
    telefono,
    direccion,
    passwordActual: datos.passwordActual || null,
    passwordNueva
  };
}

/** POST /api/auth/password — cambio de contraseña desde la cuenta. */
export function parseCambioPassword(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, new Set(["passwordActual", "passwordNueva", "confirmPassword"]), lista);

  if (typeof datos.passwordActual !== "string" || datos.passwordActual.length === 0) {
    anotar(lista, "passwordActual", "Introduce tu contraseña actual.");
  }
  const passwordNueva = validarPassword(lista, datos.passwordNueva, "passwordNueva");
  if (typeof datos.confirmPassword !== "string" || datos.confirmPassword !== passwordNueva) {
    anotar(lista, "confirmPassword", "Las contraseñas no coinciden.");
  }

  lanzarSiHayErrores(lista, "Revisa el cambio de contraseña.");
  return { passwordActual: datos.passwordActual, passwordNueva };
}

/** Códigos de notificación admitidos al crear una disponibilidad. */
export function validarCodigoDisponibilidad(lista, valor, porDefecto) {
  const codigo = texto(valor) || porDefecto;
  if (!["AVAILABLE", "BLOCKED"].includes(codigo)) {
    anotar(lista, "status", "Usa AVAILABLE o BLOCKED.");
    return porDefecto;
  }
  return codigo;
}

// validarNombre, validarDocumento, validarNacimiento, validarEmail,
// validarPassword, validarTelefono y validarDireccion ya se exportan donde se
// declaran, y client.validator.js los importa de aquí.
