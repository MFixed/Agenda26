import { errorValidacion } from "../utils/http.js";
import { esFechaISO, esHora, normalizarHora } from "../utils/date.js";

/** Piezas sueltas que usan todos los validadores. */

export function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

export function opcional(valor) {
  const limpio = texto(valor);
  return limpio === "" ? null : limpio;
}

export function errors() {
  return [];
}

export function anotar(lista, campo, mensaje) {
  lista.push({ field: campo, message: mensaje });
}

export function cuerpoObjeto(cuerpo) {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    throw errorValidacion("El cuerpo debe ser un objeto JSON.");
  }
  return cuerpo;
}

/** Rechaza campos que no deberían enviarse: evita que un cliente se auto-asigne el rol. */
export function soloCampos(cuerpo, permitidos, lista) {
  for (const campo of Object.keys(cuerpo)) {
    if (!permitidos.has(campo)) {
      anotar(lista, campo, "Campo no permitido.");
    }
  }
}

export function idPositivo(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }
  return id;
}

export function emailNormalizado(valor) {
  return texto(valor).toLowerCase();
}

export function esEmailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function fechaISOoLista(lista, campo, valor, { requerido = false } = {}) {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) {
      anotar(lista, campo, "Indica la fecha.");
    }
    return null;
  }
  if (!esFechaISO(valor)) {
    anotar(lista, campo, "Usa una fecha válida (AAAA-MM-DD).");
    return null;
  }
  return valor;
}

export function horaValida(lista, campo, valor, { requerido = false } = {}) {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) {
      anotar(lista, campo, "Indica la hora.");
    }
    return null;
  }
  const normalizada = normalizarHora(valor);
  if (!normalizada || !esHora(normalizada)) {
    anotar(lista, campo, "Usa una hora válida (HH:mm).");
    return null;
  }
  return normalizada;
}

export function lanzarSiHayErrores(lista, mensaje = "Revisa los datos del formulario.") {
  if (lista.length > 0) {
    throw errorValidacion(mensaje, lista);
  }
}
