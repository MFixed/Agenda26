/**
 * Capa de API del cliente: token en localStorage, cabecera Authorization y
 * utilidades de formato. Es lo único que sabe cómo hablar con el servidor; el
 * resto de scripts sólo llama a estas funciones.
 */

const CLAVE_TOKEN = "gestion_citas_token";

/* ---------------- Token ---------------- */

export function leerToken() {
  return window.localStorage.getItem(CLAVE_TOKEN) || "";
}

export function guardarToken(token) {
  window.localStorage.setItem(CLAVE_TOKEN, token);
}

export function borrarToken() {
  window.localStorage.removeItem(CLAVE_TOKEN);
}

/** Claims del token sin verificar. Sólo para pintar datos, nunca para decidir. */
export function claimsDelToken() {
  const token = leerToken();
  if (!token) {
    return null;
  }
  try {
    const [, payload] = token.split(".");
    return payload ? JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) : null;
  } catch {
    return null;
  }
}

/* ---------------- Peticiones ---------------- */

export async function api(ruta, opciones = {}) {
  const cabeceras = new Headers(opciones.headers || {});
  const token = leerToken();
  if (token) {
    cabeceras.set("Authorization", `Bearer ${token}`);
  }
  if (opciones.body !== undefined) {
    cabeceras.set("Content-Type", "application/json");
  }

  let respuesta;
  try {
    respuesta = await fetch(ruta, { ...opciones, headers: cabeceras });
  } catch {
    throw new Error("No hay conexión con el servidor.");
  }

  const tipo = respuesta.headers.get("content-type") || "";
  const cuerpo = tipo.includes("application/json") ? await respuesta.json() : null;

  if (!respuesta.ok) {
    // Sólo se redirige si la petición llevaba token: un 401 en una consulta sin
    // sesión no debe mandar a /login, o la página actual se recargaría en bucle.
    const esAcceso = ruta.startsWith("/api/auth/login") || ruta.startsWith("/api/auth/register");
    if (respuesta.status === 401 && !esAcceso && token) {
      borrarToken();
      window.location.assign("/login");
    }
    const error = new Error((cuerpo && cuerpo.error) || "No se pudo completar la operación.");
    error.estado = respuesta.status;
    error.detalles = (cuerpo && cuerpo.details) || null;
    throw error;
  }

  return cuerpo;
}

export const get = (ruta) => api(ruta);
export const post = (ruta, cuerpo) => api(ruta, { method: "POST", body: JSON.stringify(cuerpo) });
export const put = (ruta, cuerpo) => api(ruta, { method: "PUT", body: JSON.stringify(cuerpo) });
export const del = (ruta) => api(ruta, { method: "DELETE" });

/* ---------------- Sesión ---------------- */

export function panelDe(rol) {
  return rol === "ADMIN" ? "/admin" : "/cliente";
}

/**
 * Valida el token contra el servidor y comprueba el rol de la página. Redirige
 * si algo no cuadra, así que no hace falta tratar el valor devuelto.
 */
export async function exigirSesion(rol) {
  if (!leerToken()) {
    window.location.replace("/login");
    return null;
  }

  let sesion;
  try {
    sesion = await get("/api/auth/me");
  } catch {
    window.location.replace("/login");
    return null;
  }

  if (rol && sesion.user.role !== rol) {
    window.location.replace(panelDe(sesion.user.role));
    return null;
  }

  const chip = document.querySelector("#user-name");
  if (chip) {
    chip.textContent = sesion.user.nombre;
  }
  const insignia = document.querySelector("#rol-badge");
  if (insignia) {
    insignia.textContent = rol === "ADMIN" ? "Administración" : "Cliente";
  }

  return sesion;
}

export function conectarSalir() {
  const boton = document.querySelector("#logout-button");
  if (!boton) {
    return;
  }
  boton.addEventListener("click", () => {
    // El JWT es sin estado: cerrar sesión es olvidarlo en el navegador.
    post("/api/auth/logout").catch(() => {});
    borrarToken();
    window.location.assign("/login");
  });
}

/* ---------------- Fechas ---------------- */

/** "AAAA-MM-DD" -> "30/09/2026" (§24). */
export function fecha(valor) {
  if (!valor) {
    return "—";
  }
  const d = new Date(`${valor}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? valor
    : d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Marca de tiempo ISO -> "28/09/2026 14:05". */
export function fechaHora(valor) {
  if (!valor) {
    return "—";
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? valor
    : d.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
}

/** "AAAA-MM-DD" de hoy en la zona del navegador. */
export function hoy() {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T00:00:00`);
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Lunes de la semana que contiene la fecha. */
export function lunesDe(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00`);
  const desplazamiento = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - desplazamiento);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/* ---------------- Texto ---------------- */

export function iniciales(nombre) {
  const partes = String(nombre || "?").trim().split(/\s+/);
  return ((partes[0]?.[0] || "?") + (partes[1]?.[0] || "")).toUpperCase();
}

/** Escapa texto antes de meterlo en un innerHTML generado. */
export function esc(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------------- Avisos ---------------- */

let temporizadorToast = null;

export function toast(mensaje, esError = false) {
  const elemento = document.querySelector("#toast");
  if (!elemento) {
    return;
  }
  window.clearTimeout(temporizadorToast);
  elemento.textContent = mensaje;
  elemento.classList.toggle("error", esError);
  elemento.hidden = false;
  temporizadorToast = window.setTimeout(() => {
    elemento.hidden = true;
  }, 3500);
}

export function mensaje(elemento, texto, esError = false) {
  if (!elemento) {
    return;
  }
  elemento.textContent = texto;
  elemento.classList.toggle("error", esError);
}

/** Junta los errores por campo de la API en un solo renglón. */
export function textoError(error) {
  if (error && Array.isArray(error.detalles) && error.detalles.length > 0) {
    return error.detalles.map((detalle) => detalle.message).join(" ");
  }
  return (error && error.message) || "Ha ocurrido un error.";
}

/* ---------------- Rótulos de estado ---------------- */

export const ESTADOS_CITA = {
  PENDING: { texto: "Pendiente", clase: "status-pending" },
  COORDINATED: { texto: "Coordinada", clase: "status-validated" },
  COMPLETED: { texto: "Completada", clase: "status-completed" },
  CANCELLED: { texto: "Cancelada", clase: "status-cancelled" },
  REJECTED: { texto: "Rechazada", clase: "status-rejected" }
};

export const ESTADOS_TAREA = {
  PENDING: { texto: "Pendiente", clase: "status-pending" },
  IN_PROGRESS: { texto: "En curso", clase: "status-progress" },
  COMPLETED: { texto: "Completada", clase: "status-completed" },
  CANCELLED: { texto: "Cancelada", clase: "status-cancelled" }
};

export const ESTADOS_HUECO = {
  AVAILABLE: { texto: "Libre", clase: "status-available" },
  HELD: { texto: "En espera", clase: "status-pending" },
  RESERVED: { texto: "Reservado", clase: "status-validated" },
  BLOCKED: { texto: "Bloqueado", clase: "status-cancelled" }
};

export function insignia(estado, mapa) {
  const info = mapa[estado] || { texto: estado, clase: "status-cancelled" };
  return `<span class="status-pill ${info.clase}">${esc(info.texto)}</span>`;
}

/* ---------------- Formularios ---------------- */

/** Lee un <form> como objeto plano de cadenas. */
export function datosDe(formulario) {
  const salida = {};
  for (const [clave, valor] of new FormData(formulario).entries()) {
    salida[clave] = typeof valor === "string" ? valor.trim() : valor;
  }
  for (const casilla of formulario.querySelectorAll('input[type="checkbox"]')) {
    salida[casilla.name] = casilla.checked;
  }
  return salida;
}

/** Rellena un formulario con un objeto, sin tocar los checkboxes ausentes. */
export function rellenar(formulario, valores) {
  formulario.reset();
  for (const [clave, valor] of Object.entries(valores || {})) {
    const campo = formulario.elements.namedItem(clave);
    if (!campo) {
      continue;
    }
    if (campo.type === "checkbox") {
      campo.checked = Boolean(valor);
    } else {
      campo.value = valor ?? "";
    }
  }
}
