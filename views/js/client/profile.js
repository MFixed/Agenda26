/**
 * Perfil del cliente: consulta y edita sus datos permitidos, cambia su
 * contraseña, gestiona las sesiones abiertas y ajusta sus preferencias.
 *
 * El rol y el estado de la cuenta no se envían nunca: el servidor los rechaza,
 * y aquí ni siquiera existen como campos del formulario.
 */
import {
  claimsDelToken,
  datosDe,
  del,
  esc,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  patch,
  post,
  put,
  textoError,
} from '../api.js';
import {
  abrirDialogo,
  aviso,
  confirmar,
  conectarCierres,
  esqueleto,
  marcarErrores,
  montarApp,
  vacio,
} from '../ui.js';

const sesion = await exigirSesion('CLIENT');
if (!sesion) {
  throw new Error('sin sesion');
}

montarApp(sesion, 'cliente');
conectarCierres();

const formulario = document.querySelector('#perfil-form');
const error = document.querySelector('#perfil-error');
const mensaje = document.querySelector('#perfil-message');

let ficha = null;

/* ---------------- Datos personales ---------------- */

function pintar(cliente) {
  ficha = cliente;
  formulario.elements.namedItem('nombre').value = cliente?.nombre || '';
  formulario.elements.namedItem('documento').value = cliente?.documento || '';
  formulario.elements.namedItem('fechaNacimiento').value = cliente?.fechaNacimiento || '';
  formulario.elements.namedItem('email').value = cliente?.email || sesion.user.email || '';
  formulario.elements.namedItem('telefono').value = cliente?.telefono || '';
  formulario.elements.namedItem('direccion').value = cliente?.direccion || '';
}

function pintarCuenta(cliente) {
  document.querySelector('#cuenta-rol').textContent = 'Cliente';
  document.querySelector('#cuenta-estado').textContent = sesion.user.activo ? 'Activa' : 'Inactiva';
  document.querySelector('#cuenta-citas').textContent = String(sesion.citas ?? 0);
  document.querySelector('#cuenta-alta').textContent = fecha(cliente?.createdAt);
  document.querySelector('#cuenta-acceso').textContent = fechaHora(sesion.user.ultimoAcceso);

  const claims = claimsDelToken();
  document.querySelector('#cuenta-sesion').textContent = claims?.exp
    ? fechaHora(new Date(claims.exp * 1000))
    : '—';
}

async function cargar() {
  try {
    const { cliente } = await get('/api/clients/me');
    pintar(cliente);
    pintarCuenta(cliente);
  } catch (problem) {
    aviso(textoError(problem), 'error');
    /* El formulario se rellena con lo que hay en la sesión, para que al menos
       se vea qué cuenta está conectada aunque la ficha no haya llegado. */
    pintar({ nombre: sesion.user.nombre, email: sesion.user.email });
    pintarCuenta(null);
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  error.hidden = true;
  error.textContent = '';
  mensaje.textContent = '';
  marcarErrores(formulario, null);

  if (!formulario.reportValidity()) {
    return;
  }

  const datos = datosDe(formulario);
  const boton = document.querySelector('#perfil-guardar');
  boton.disabled = true;

  try {
    const respuesta = await put('/api/clients/me', {
      nombre: datos.nombre,
      documento: datos.documento,
      fechaNacimiento: datos.fechaNacimiento,
      email: datos.email,
      telefono: datos.telefono || null,
      direccion: datos.direccion || null,
    });

    pintar(respuesta.cliente);
    mensaje.textContent = `Perfil actualizado (${fechaHora(respuesta.cliente?.updatedAt)}).`;
    aviso('Perfil guardado.', 'ok');
  } catch (problema) {
    marcarErrores(formulario, problema, { general: error });
  } finally {
    boton.disabled = false;
  }
});

document.querySelector('#perfil-descartar').addEventListener('click', () => {
  if (ficha) {
    pintar(ficha);
  }
  error.hidden = true;
  error.textContent = '';
  mensaje.textContent = '';
  marcarErrores(formulario, null);
});

/* ---------------- Contraseña ---------------- */

const dialogoPassword = document.querySelector('#password-dialog');
const formularioPassword = document.querySelector('#password-form');
const errorPassword = document.querySelector('#password-error');

document.querySelector('#abrir-password').addEventListener('click', () => {
  formularioPassword.reset();
  errorPassword.hidden = true;
  errorPassword.textContent = '';
  abrirDialogo('password-dialog');
});

formularioPassword.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorPassword.hidden = true;
  errorPassword.textContent = '';
  marcarErrores(formularioPassword, null);

  if (!formularioPassword.reportValidity()) {
    return;
  }

  const datos = datosDe(formularioPassword);
  const boton = formularioPassword.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    await post('/api/auth/password', {
      passwordActual: datos.passwordActual,
      passwordNueva: datos.passwordNueva,
      confirmPassword: datos.confirmPassword,
    });
    dialogoPassword.close();
    aviso('Contraseña actualizada.', 'ok');
    /* Cambiar la contraseña invalida los tokens: hay que volver a entrar. */
    aviso('Por seguridad, vuelve a iniciar sesión.', 'info');
    window.setTimeout(() => {
      window.localStorage.removeItem('agenda26_access');
      window.localStorage.removeItem('agenda26_refresh');
      window.location.assign('/cliente');
    }, 1800);
  } catch (problema) {
    marcarErrores(formularioPassword, problema, { general: errorPassword });
  } finally {
    boton.disabled = false;
  }
});

/* ---------------- Sesiones abiertas ---------------- */

/* "Cerrar sesión en todos los dispositivos" es de las pocas cosas que la gente
   da por hecha y aquí sí existe. */
async function cargarSesiones() {
  const destino = document.querySelector('#lista-sesiones');
  destino.innerHTML = esqueleto(2);

  try {
    const { items } = await get('/api/auth/sessions');
    const sesiones = items || [];

    destino.innerHTML =
      sesiones.length === 0
        ? vacio('Sin sesiones abiertas', 'Vuelve a iniciar sesión para aparecer aquí.')
        : sesiones.map(filaSesion).join('');

    for (const boton of destino.querySelectorAll('[data-cerrar-sesion]')) {
      boton.addEventListener('click', async () => {
        const id = Number(boton.dataset.cerrarSesion);
        const ok = await confirmar({
          titulo: 'Cerrar sesión',
          texto: 'Ese dispositivo tendrá que volver a iniciar sesión.',
          aviso: 'Si no reconoces la sesión, cierra también la tuya desde el botón de salir.',
          textoBoton: 'Cerrar sesión',
        });
        if (!ok) {
          return;
        }
        try {
          await del(`/api/auth/sessions/${id}`);
          aviso('Sesión cerrada.', 'ok');
          await cargarSesiones();
        } catch (error) {
          aviso(textoError(error), 'error');
        }
      });
    }
  } catch (error) {
    destino.innerHTML = '';
    destino.insertAdjacentHTML('beforeend', vacio('No se pudieron cargar las sesiones', textoError(error)));
  }
}

/** Una sesión en lenguaje llano: "Chrome en Windows" es más útil que un
    user-agent entero en una lista. */
function filaSesion(sesionItem) {
  const navegador = detectarNavegador(sesionItem.userAgent);
  const sistema = detectarSistema(sesionItem.userAgent);

  return `
    <div class="client-row">
      <span class="avatar" aria-hidden="true">${esc(navegador.inicial)}</span>
      <div class="client-row-main">
        <span class="client-row-name">${esc(navegador.nombre)}</span>
        <span class="client-row-meta">
          ${esc(sistema)}
          ${sesionItem.ip ? ` · ${esc(sesionItem.ip)}` : ''}
        </span>
        <span class="client-row-meta">Desde ${esc(fechaHora(sesionItem.createdAt))}</span>
      </div>
    </div>`;
}

function detectarNavegador(userAgent = '') {
  if (!userAgent) {
    return { nombre: 'Dispositivo desconocido', inicial: '?' };
  }
  if (/edg\//i.test(userAgent)) return { nombre: 'Edge', inicial: 'E' };
  if (/chrome|crios/i.test(userAgent)) return { nombre: 'Chrome', inicial: 'C' };
  if (/firefox/i.test(userAgent)) return { nombre: 'Firefox', inicial: 'F' };
  if (/safari/i.test(userAgent)) return { nombre: 'Safari', inicial: 'S' };
  return { nombre: 'Navegador desconocido', inicial: '?' };
}

function detectarSistema(userAgent = '') {
  if (!userAgent) {
    return 'Sistema desconocido';
  }
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/mac os/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Sistema desconocido';
}

/* ---------------- Preferencias ---------------- */

const formularioAjustes = document.querySelector('#ajustes-form');
const errorAjustes = document.querySelector('#ajustes-error');

/* Se ofrecen las zonas horarias habituales. Un <select> con las 400 de IANA
   sería más completo y mucho menos usable: nadie sabe si su ciudad es
   "America/Montevideo" o "America/Argentina/Montevideo". */
const ZONAS = [
  { valor: 'America/Montevideo', etiqueta: 'Montevideo (Uruguay)' },
  { valor: 'America/Argentina/Buenos_Aires', etiqueta: 'Buenos Aires (Argentina)' },
  { valor: 'America/Santiago', etiqueta: 'Santiago (Chile)' },
  { valor: 'America/Bogota', etiqueta: 'Bogotá (Colombia)' },
  { valor: 'America/Lima', etiqueta: 'Lima (Perú)' },
  { valor: 'America/Mexico_City', etiqueta: 'Ciudad de México' },
  { valor: 'America/Sao_Paulo', etiqueta: 'São Paulo (Brasil)' },
  { valor: 'America/Madrid', etiqueta: 'Madrid (España)' },
  { valor: 'Europe/London', etiqueta: 'Londres (Reino Unido)' },
];

/* La zona del navegador es la que casi siempre es la correcta: se ofrece
   primero y las demás detrás. */
function zonaDetectada() {
  try {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return ZONAS.some((z) => z.valor === zona) ? zona : 'America/Montevideo';
  } catch {
    return 'America/Montevideo';
  }
}

document.querySelector('#ajuste-timezone').innerHTML = ZONAS.map(
  (zona) => `<option value="${zona.valor}">${esc(zona.etiqueta)}</option>`
).join('');

function pintarAjustes(settings) {
  if (!settings) {
    return;
  }
  document.querySelector('#ajuste-email').checked = Boolean(settings.emailOptIn);
  document.querySelector('#ajuste-locale').value = settings.locale || 'es-ES';
  document.querySelector('#ajuste-timezone').value =
    settings.timezone && ZONAS.some((z) => z.valor === settings.timezone)
      ? settings.timezone
      : zonaDetectada();
  document.querySelector('#ajuste-theme').value = settings.theme || 'auto';
}

formularioAjustes.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorAjustes.hidden = true;
  errorAjustes.textContent = '';

  const datos = datosDe(formularioAjustes);
  const boton = formularioAjustes.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    await patch('/api/auth/settings', {
      emailOptIn: datos.emailOptIn,
      locale: datos.locale,
      timezone: datos.timezone,
      theme: datos.theme,
    });
    aviso('Preferencias guardadas.', 'ok');
  } catch (error) {
    errorAjustes.textContent = textoError(error);
    errorAjustes.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

/* El tema se aplica al momento de cambiarlo, sin esperar al guardado: es un
   ajuste que se nota en la propia pantalla que lo cambia. */
document.querySelector('#ajuste-theme').addEventListener('change', (evento) => {
  const tema = evento.target.value;
  if (tema === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', tema);
  }
  window.localStorage.setItem('agenda26_tema', tema);
});

/* ---------------- Arranque ---------------- */

pintarAjustes(sesion.settings);
await cargar();
await cargarSesiones();
