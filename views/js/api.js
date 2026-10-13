/**
 * Capa de API: es lo UNICO que sabe hablar con el servidor. El resto de
 * scripts llama a get/post/put/patch/del y nunca ve un fetch.
 *
 * Lo delicado de v2 es que hay dos tokens. El access token caduca en minutos;
 * cuando caduca, un 401 no significa "tu sesion se acabo" sino "este token
 * concreto se agoto". Por eso un 401 dispara UN refresh y la peticion se
 * reintenta una sola vez. Si el refresh tambien falla, ahi si se borra todo y
 * se vuelve al acceso.
 *
 * El refresh se hace UNA vez aunque lleguen cinco peticiones caducadas a la vez
 * (ver refrescoEnCurso): cinco refresh simultaneos sobre el mismo token
 * crearian cinco sesiones y dejarian cuatro refresh tokens huerfanos.
 */

const CLAVE_ACCESS = 'agenda26_access';
const CLAVE_REFRESH = 'agenda26_refresh';
const CLAVE_NEGOCIO = 'agenda26_negocio';

/* Rutas donde un 401 NO debe disparar refresh ni redireccion: son las puertas
   de entrada. Si se reintentan, /login reenvia a /login en bucle. */
const RUTAS_PUBLICAS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'];

/* ---------------- Almacenamiento tolerante ---------------- */

/**
 * `localStorage` no siempre existe ni siempre deja escribir.
 *
 * En modo privado de Safari, con las cookies de terceros bloqueadas o con el
 * almacenamiento lleno, `getItem` y `setItem` LANZAN. Antes de que esto existiera,
 * ese throw se propagaba desde `montarTema` y abortaba el montaje entero: sin
 * navegacion, sin nombre y sin boton de salir, en una pagina que si funciona.
 *
 * Toda la app pasa por aqui, y cada acceso va con su propio `catch`. Un
 * almacenamiento que falla degrada a "sin sesion guardada", no a una pagina rota.
 */
const almacen = {
  leer(clave) {
    try {
      return window.localStorage.getItem(clave);
    } catch {
      return null;
    }
  },
  escribir(clave, valor) {
    try {
      window.localStorage.setItem(clave, valor);
      return true;
    } catch {
      /// Cuota llena o modo privado: la sesion no se recuerda entre recargas, pero
      /// la peticion actual sigue siendo valida.
      return false;
    }
  },
  borrar(clave) {
    try {
      window.localStorage.removeItem(clave);
    } catch {
      /* nada que hacer */
    }
  },
};

/**
 * Memoria de la pestana para cuando el almacenamiento no funciona.
 *
 * `leerAccess` primero mira el almacenamiento; si no hay nada ahi, mira aqui. Asi
 * la sesion sobrevive a los `reload` de la propia pagina en modo privado, donde
 * `setItem` lanza. Se pierde al cerrar la pestana, que es justo lo que se acepta
 * cuando el navegador no deja guardar nada.
 */
let sesionEnMemoria = { accessToken: '', refreshToken: '' };

/* ---------------- Tokens ---------------- */

export function leerAccess() {
  return almacen.leer(CLAVE_ACCESS) || sesionEnMemoria.accessToken || '';
}

export function leerRefresh() {
  return almacen.leer(CLAVE_REFRESH) || sesionEnMemoria.refreshToken || '';
}

/**
 * Guarda el par que devuelve login, register y refresh.
 *
 * Si el almacenamiento falla, el token se queda en memoria para que la pagina
 * siga funcionando; solo se pierde al cerrar la pestana.
 *
 * @returns {boolean} si se pudo persistir de verdad.
 */
export function guardarTokens(respuesta) {
  const acceso = respuesta?.accessToken;
  const refresco = respuesta?.refreshToken;

  if (acceso) {
    sesionEnMemoria.accessToken = acceso;
  }
  if (refresco) {
    sesionEnMemoria.refreshToken = refresco;
  }

  let guardado = true;
  if (acceso) {
    guardado = almacen.escribir(CLAVE_ACCESS, acceso) && guardado;
  }
  if (refresco) {
    guardado = almacen.escribir(CLAVE_REFRESH, refresco) && guardado;
  }

  return guardado;
}

export function borrarTokens() {
  almacen.borrar(CLAVE_ACCESS);
  almacen.borrar(CLAVE_REFRESH);
  sesionEnMemoria = { accessToken: '', refreshToken: '' };
}

export function haySesion() {
  return Boolean(leerAccess());
}

/** Claims del JWT sin verificar. Solo para pintar datos, nunca para decidir. */
export function claimsDelToken() {
  const token = leerAccess();
  if (!token) {
    return null;
  }
  try {
    const [, payload] = token.split('.');
    return payload ? JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) : null;
  } catch {
    return null;
  }
}

/* ---------------- Negocio de la ruta ---------------- */

/**
 * El slug va en la ruta (/b/mi-negocio/login). Se guarda porque al caducar la
 * sesion hay que volver a la puerta CORRECTA: quien entra por su empresa no
 * debe aterrizar en la de otra.
 */
export function guardarNegocio(slug) {
  if (slug) {
    almacen.escribir(CLAVE_NEGOCIO, slug);
  } else {
    almacen.borrar(CLAVE_NEGOCIO);
  }
}

export function leerNegocio() {
  return almacen.leer(CLAVE_NEGOCIO) || '';
}

/** Slug de la ruta actual, o "" si no estamos en una puerta de negocio. */
export function negocioDeLaRuta() {
  const coincidencia = window.location.pathname.match(/^\/b\/([^/]+)/);
  return coincidencia ? coincidencia[1] : '';
}

export function panelDe(rol) {
  if (rol === 'SUPERADMIN') {
    return '/super';
  }
  return rol === 'ADMIN' || rol === 'STAFF' ? '/admin' : '/cliente';
}

/**
 * Vuelve a la puerta de acceso, y a la CORRECTA.
 *
 * Se prefiere el slug de la URL sobre el guardado: `leerNegocio()` solo se
 * escribe al iniciar sesion, asi que quien entro por la empresa A, abrio
 * /b/B/login y tiene el token caducado volvia a la puerta de A. Con la ruta se
 * manda a la que esta escribiendo, que es la que quiere.
 */
function volverAlAcceso() {
  const destino = negocioDeLaRuta() || leerNegocio();
  window.location.assign(destino ? `/b/${destino}/login` : '/login');
}

/* ---------------- Refresh con cola ---------------- */

let refrescoEnCurso = null;

/**
 * Renueva el access token. Todas las peticiones que sufren un 401 mientras hay
 * uno en marcha comparten ESA promesa en vez de lanzar el suyo: es lo que evita
 * el enjambre de refrescos.
 */
async function refrescarToken() {
  if (refrescoEnCurso) {
    return refrescoEnCurso;
  }

  const refreshToken = leerRefresh();
  if (!refreshToken) {
    return null;
  }

  refrescoEnCurso = (async () => {
    try {
      const respuesta = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!respuesta.ok) {
        return null;
      }

      const cuerpo = await respuesta.json();
      guardarTokens(cuerpo);
      return cuerpo;
    } catch {
      return null;
    } finally {
      refrescoEnCurso = null;
    }
  })();

  return refrescoEnCurso;
}

/* ---------------- Peticiones ---------------- */

/**
 * Peticion autenticada con recuperacion de sesion.
 *
 * @param {string} ruta
 * @param {object} [opciones] - opciones de fetch, mas `{ reintentado: true }`.
 * @returns {Promise<any>} el cuerpo JSON, o null en 204.
 * @throws {Error} con `.estado`, `.detalles` y `.requestId` si falla.
 */
export async function api(ruta, opciones = {}) {
  const cabeceras = new Headers(opciones.headers || {});
  const token = leerAccess();

  if (token) {
    cabeceras.set('Authorization', `Bearer ${token}`);
  }
  if (opciones.body !== undefined) {
    cabeceras.set('Content-Type', 'application/json');
  }

  let respuesta;
  try {
    respuesta = await fetch(ruta, { ...opciones, headers: cabeceras });
  } catch {
    const error = new Error('No hay conexion con el servidor.');
    error.estado = 0;
    throw error;
  }

  // 204 llega sin cuerpo: no se intenta parsear JSON.
  if (respuesta.status === 204) {
    return null;
  }

  const tipo = respuesta.headers.get('content-type') || '';
  const cuerpo = tipo.includes('application/json') ? await respuesta.json().catch(() => null) : null;

  if (respuesta.ok) {
    return cuerpo;
  }

  const esPublica = RUTAS_PUBLICAS.some((prefijo) => ruta.startsWith(prefijo));

  // 401 con token y sin haberlo intentado ya: un refresh y un reintento, solo
  // uno. Un bucle de reintentos sobre un token muerto nunca sale y deja la
  // pagina en "Cargando..." para siempre.
  if (respuesta.status === 401 && token && !esPublica) {
    if (opciones.reintentado) {
      /*
       * Segundo 401 del mismo intento: el refresh funciono pero el token nuevo
       * tampoco vale (cuenta desactivada, `tokenVersion` subido por un logout
       * global o un cambio de contrasena). Sin esta salida los tokens caducados
       * se quedan en localStorage y cada pantalla termina en
       * `throw new Error("sin sesion")` sin mandar a nadie al acceso.
       */
      borrarTokens();
      volverAlAcceso();
    } else {
      const renovado = await refrescarToken();

      /*
       * El reintento puede volver a dar 401: entonces el `api` de dentro lanza, el
       * error sube a la pantalla y, como venia con `reintentado: true`, la
       * siguiente peticion entra por la rama de arriba y limpia la sesion. No hace
       * falta capturar nada aqui.
       */
      if (renovado) {
        return await api(ruta, { ...opciones, reintentado: true });
      }

      // El refresh tambien falla: ahi si se acabo la sesion.
      borrarTokens();
      volverAlAcceso();
    }
  }

  const error = new Error(cuerpo?.error || 'No se pudo completar la operacion.');
  error.estado = respuesta.status;
  error.detalles = Array.isArray(cuerpo?.details) ? cuerpo.details : [];
  error.requestId = cuerpo?.requestId || null;
  throw error;
}

/** Construye "?a=1&b=2" saltando vacios. Evita repetir el mismo if en cada pantalla. */
export function query(parametros) {
  const busqueda = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros || {})) {
    if (valor !== '' && valor !== null && valor !== undefined) {
      busqueda.set(clave, String(valor));
    }
  }
  const texto = busqueda.toString();
  return texto ? `?${texto}` : '';
}

export const get = (ruta) => api(ruta);
export const post = (ruta, cuerpo) => api(ruta, { method: 'POST', body: JSON.stringify(cuerpo ?? {}) });
export const put = (ruta, cuerpo) => api(ruta, { method: 'PUT', body: JSON.stringify(cuerpo ?? {}) });
export const patch = (ruta, cuerpo) => api(ruta, { method: 'PATCH', body: JSON.stringify(cuerpo ?? {}) });
export const del = (ruta, cuerpo) =>
  api(ruta, { method: 'DELETE', body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });

/* ---------------- Sesion ---------------- */

/**
 * Valida el token contra el servidor y comprueba el rol de la pagina. Si algo
 * no cuadra redirige, asi que no hace falta mirar el valor devuelto.
 *
 * `permitidos` acepta varios roles porque en v2 el panel lo comparten ADMIN y
 * STAFF: el profesional entra al mismo sitio que su jefe, solo que ve menos.
 */
export async function exigirSesion(permitidos = null) {
  if (!haySesion()) {
    volverAlAcceso();
    return null;
  }

  let sesion;
  try {
    sesion = await get('/api/auth/me');
  } catch (error) {
    // Un 500 del servidor NO debe echar a nadie: perderia su trabajo por un
    // fallo ajeno. Solo se devuelve null cuando de verdad no hay sesion (el
    // propio api.js ya redirigio en ese caso).
    if (error.estado === 401 || error.estado === 403) {
      return null;
    }
    // La pagina se dibuja igual, pero avisando de que los datos no llegaron.
    return {
      user: { nombre: '', email: '', role: 'INVITADO', activo: true },
      negocio: null,
      staff: null,
      settings: null,
      citas: 0,
      errorTemporal: true,
    };
  }

  const roles = Array.isArray(permitidos) ? permitidos : permitidos ? [permitidos] : null;
  if (roles && !roles.includes(sesion.user.role)) {
    window.location.replace(panelDe(sesion.user.role));
    return null;
  }

  return sesion;
}

/**
 * Engancha el boton de salir. Busca [data-salir], no un id: la cabecera de
 * movil y el pie del sidebar de escritorio son dos botones distintos con lo
 * mismo que hacer, y no pueden quedar uno sin cerrar sesion.
 *
 * @param {{todos?: boolean}} opciones - `todos` revoca todas las sesiones.
 */
export function conectarSalir({ todos = false } = {}) {
  for (const boton of document.querySelectorAll('[data-salir]')) {
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        // El refresh token viaja en el cuerpo para revocar SOLO esta sesion;
        // con ?todos=true se caen todas las del usuario.
        await post(`/api/auth/logout${todos ? '?todos=true' : ''}`, { refreshToken: leerRefresh() });
      } catch {
        // Un logout que falla por red no puede impedir cerrar sesion en el
        // navegador: si no, el usuario se queda atrapado en una sesion rota.
      }
      borrarTokens();
      window.localStorage.removeItem(CLAVE_NEGOCIO);
      window.location.assign('/');
    });
  }
}

/* ---------------- Fechas ---------------- */

/** "AAAA-MM-DD" -> "30/09/2026". */
export function fecha(valor) {
  if (!valor) {
    return '—';
  }
  const d = new Date(`${String(valor).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(valor)
    : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Marca de tiempo ISO -> "28/09/2026 14:05". */
export function fechaHora(valor) {
  if (!valor) {
    return '—';
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime())
    ? String(valor)
    : d.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/** "AAAA-MM-DD" de hoy en la zona del navegador, no en UTC. */
export function hoy() {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T00:00:00`);
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Lunes de la semana que contiene la fecha. */
export function lunesDe(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00`);
  const desplazamiento = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - desplazamiento);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** "Lunes, 30 de septiembre". El anio solo aparece si no es el de ahora. */
export function diaLargo(fechaISO) {
  if (!fechaISO) {
    return '—';
  }
  const d = new Date(`${fechaISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return String(fechaISO);
  }
  const capital = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);
  const dia = capital(d.toLocaleDateString('es-ES', { weekday: 'long' }));
  const resto = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  const anio = d.getFullYear() === new Date().getFullYear() ? '' : ` de ${d.getFullYear()}`;
  return `${dia}, ${resto}${anio}`;
}

/** "1 cita" / "3 citas". Un contador con sufijo fijo se lee mal. */
export function plural(total, singular, plurial) {
  const n = Number(total) || 0;
  return `${n} ${n === 1 ? singular : plurial}`;
}

/* ---------------- Citas ---------------- */

/**
 * Normaliza una cita para que las pantallas la lean siempre igual.
 *
 * El backend expone el profesional como `profesional` (`citaView` saca `staff` del
 * objeto y lo publica con ese nombre, para que el JSON no confunda "la persona que
 * atiende" con "el usuario que tiene rol"). Cuatro pantallas leian `cita.staff`,
 * que nunca llegaba: el profesional no se mostraba en ninguna parte.
 *
 * Aqui se expone el mismo dato en los dos nombres, en los listados y en el
 * detalle, y no hace falta tocar cada pantalla ni acordarse de cual es.
 *
 * @param {object} cita
 * @returns {object}
 */
export function normalizarCita(cita) {
  if (!cita || typeof cita !== 'object') {
    return cita;
  }

  const profesional = cita.profesional ?? cita.staff ?? null;

  return profesional ? { ...cita, profesional, staff: profesional } : cita;
}

/** Igual que `normalizarCita`, pero sobre un listado. */
export function normalizarCitas(citas) {
  return Array.isArray(citas) ? citas.map(normalizarCita) : citas;
}

/* ---------------- Texto ---------------- */

export function iniciales(nombre) {
  const partes = String(nombre || '?')
    .trim()
    .split(/\s+/);
  return ((partes[0]?.[0] || '?') + (partes[1]?.[0] || '')).toUpperCase();
}

/** Escapa texto antes de meterlo en un innerHTML generado. */
export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Recorta sin partir palabras a mitad: "Instalacion de aire…" no "Instala…". */
export function recortar(texto, largo = 60) {
  const limpio = String(texto ?? '').trim();
  return limpio.length > largo ? `${limpio.slice(0, largo - 1).trimEnd()}…` : limpio;
}

/* ---------------- Rotulos de estado ---------------- */

export const ESTADOS_CITA = {
  PENDING: { texto: 'Pendiente', clase: 'status-pending' },
  COORDINATED: { texto: 'Coordinada', clase: 'status-ok' },
  COMPLETED: { texto: 'Completada', clase: 'status-ok' },
  CANCELLED: { texto: 'Cancelada', clase: 'status-off' },
  REJECTED: { texto: 'Rechazada', clase: 'status-bad' },
  NO_SHOW: { texto: 'No asistio', clase: 'status-bad' },
};

export const ESTADOS_TAREA = {
  PENDING: { texto: 'Pendiente', clase: 'status-pending' },
  IN_PROGRESS: { texto: 'En curso', clase: 'status-progress' },
  COMPLETED: { texto: 'Completada', clase: 'status-ok' },
  CANCELLED: { texto: 'Cancelada', clase: 'status-off' },
};

export const ESTADOS_HUECO = {
  AVAILABLE: { texto: 'Libre', clase: 'status-ok' },
  HELD: { texto: 'En espera', clase: 'status-pending' },
  RESERVED: { texto: 'Reservado', clase: 'status-info' },
  BLOCKED: { texto: 'Bloqueado', clase: 'status-off' },
};

export const ROLES = {
  SUPERADMIN: { texto: 'Plataforma', clase: 'badge-admin' },
  ADMIN: { texto: 'Administracion', clase: 'badge-admin' },
  STAFF: { texto: 'Profesional', clase: 'badge-staff' },
  CLIENT: { texto: 'Cliente', clase: 'badge-client' },
};

/** Insignia de estado. Si el estado no esta en el mapa se muestra tal cual. */
export function insignia(estado, mapa) {
  const info = mapa[estado] || { texto: estado || '—', clase: 'status-off' };
  return `<span class="pill ${info.clase}">${esc(info.texto)}</span>`;
}

/* ---------------- Formularios ---------------- */

/** Lee un <form> como objeto plano de cadenas, con los checkboxes como booleanos. */
export function datosDe(formulario) {
  const salida = {};
  for (const [clave, valor] of new FormData(formulario).entries()) {
    salida[clave] = typeof valor === 'string' ? valor.trim() : valor;
  }
  for (const casilla of formulario.querySelectorAll('input[type="checkbox"]')) {
    if (casilla.name) {
      salida[casilla.name] = casilla.checked;
    }
  }
  return salida;
}

/** Rellena un formulario con un objeto. Los checkbox ausentes no se tocan. */
export function rellenar(formulario, valores) {
  formulario.reset();
  for (const [clave, valor] of Object.entries(valores || {})) {
    const campo = formulario.elements.namedItem(clave);
    if (!campo) {
      continue;
    }
    if (campo.type === 'checkbox') {
      campo.checked = Boolean(valor);
    } else {
      campo.value = valor ?? '';
    }
  }
}

/* ---------------- Errores ---------------- */

/**
 * La API devuelve {error, details:[{field,message}], requestId}.
 * `error` es el mensaje general y `details` va pegado a cada campo: "el correo
 * ya esta en uso" junto al campo del correo enseña mas que un unico "no se pudo
 * guardar" al final del formulario.
 */
export function textoError(error) {
  if (Array.isArray(error?.detalles) && error.detalles.length > 0) {
    return error.detalles.map((detalle) => detalle.message).join(' ');
  }
  return error?.message || 'Ha ocurrido un error.';
}

/** Primer mensaje de un campo concreto, o null. */
export function errorDeCampo(error, campo) {
  const detalle = error?.detalles?.find((item) => item.field === campo);
  return detalle ? detalle.message : null;
}

/** Referencia legible del fallo para quien soporte tenga que buscarlo. */
export function idDePeticion(error) {
  return error?.requestId ? ` (ref. ${error.requestId})` : '';
}
