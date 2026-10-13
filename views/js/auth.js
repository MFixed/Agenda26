/**
 * Puertas de acceso: login, registro, recuperación y reinicio de contraseña.
 * Las cuatro comparten este archivo porque comparten el mismo problema: leer
 * el formulario, enviarlo y volver a pintar el error.
 *
 * La misma pagina sirve para la puerta de cada empresa (/b/:slug/login) y para
 * el acceso de la plataforma (/login, sin identificador). El slug sale de la
 * URL, no de un parametro: es la direccion que el visitante ha escrito y no se
 * puede inventar desde el formulario.
 */
import {
  get,
  guardarNegocio,
  guardarTokens,
  haySesion,
  negocioDeLaRuta,
  panelDe,
  post,
  textoError,
} from './api.js';
import { aviso } from './ui.js';

const pagina = document.body.dataset.page;
const formulario = document.querySelector('#auth-form');
const boton = document.querySelector('#auth-submit');
const error = document.querySelector('#auth-error');

/*
 * NO se borran los tokens al entrar en esta pagina.
 *
 * Se hacia para "empezar de cero", pero el efecto era el contrario del buscado:
 * abrir /login en cualquier pestana vaciaba el localStorage COMPARTIDO del
 * navegador, y las demas pestanas de esa misma sesion se comian un 401 al momento.
 * Ademas `borrarTokens()` aqui hacia que el `haySesion()` de mas abajo fuera
 * codigo muerto: nunca podia ser cierto, asi que el "ya tienes sesion" no
 * redireccionaba nunca.
 *
 * Los tokens caducados se limpian solos en `api.js` cuando una peticion devuelve
 * 401, que es donde se puede comprobar de verdad si sirven.
 */

const negocio = negocioDeLaRuta();

/* Los enlaces entre login, registro y recuperación se quedan dentro del
   negocio: salir de /b/mi-negocio/login a /login perderia el identificador y el
   visitante aterriza en la puerta equivocada. */
for (const enlace of document.querySelectorAll('[data-puerta]')) {
  const destino = enlace.getAttribute('href') || '';
  if (negocio) {
    enlace.setAttribute(
      'href',
      destino
        .replace('/login', `/b/${negocio}/login`)
        .replace('/registro', `/b/${negocio}/registro`)
        .replace('/recuperar', `/b/${negocio}/recuperar`)
    );
  }
}

/* ---------------- ¿Ya hay sesión? ---------------- */

/* En la de reinicio no se salta al panel: se llega con un token de un solo uso
   en la URL y hay que gastarlo aunque haya otra sesion abierta en el mismo
   navegador. */
if (haySesion() && pagina !== 'reset') {
  get('/api/auth/me')
    .then((sesion) => window.location.replace(panelDe(sesion.user.role)))
    .catch(() => {
      // Token caducado o revocado: api.js ya lo borro. Se sigue al formulario.
    });
}

/* ---------------- Nombre del negocio ---------------- */

if (negocio) {
  get(`/api/negocios/${encodeURIComponent(negocio)}`)
    .then((datos) => {
      const nombre = datos.negocio?.nombre;
      if (!nombre) {
        return;
      }
      const marca = document.querySelector('.brand-text strong');
      if (marca) {
        marca.textContent = nombre;
      }
      const h1 = document.querySelector('h1');
      if (h1?.dataset.negocio === 'si') {
        h1.textContent = nombre;
      }
    })
    .catch(() => {
      /* Un identificador que no existe, o una empresa desactivada, no llegan a
         pintar nada. Se avisa aqui: si no, el visitante ve un formulario normal
         que siempre fallaria con "no existe" y no sabria que se equivoco en la
         direccion. */
      const subtitulo = document.querySelector('#login-subtitulo');
      if (subtitulo) {
        subtitulo.textContent = `No encontramos ningún negocio con el identificador "${negocio}". Revísalo o vuelve al inicio.`;
      }
      if (boton) {
        boton.disabled = true;
      }
    });
} else if (pagina === 'login') {
  /* /login sin slug es la puerta de la plataforma: solo entra el
     superadministrador. Las cuentas de ejemplo del seed no valen aqui, asi que
     se cambian en vez de dejar unos botones que no funcionan. */
  const subtitulo = document.querySelector('#login-subtitulo');
  if (subtitulo) {
    subtitulo.textContent =
      'Acceso del equipo de la plataforma. Los clientes y la administración de cada empresa entran por su propia dirección.';
  }
  const lista = document.querySelector('#demo .demo-accounts');
  if (lista) {
    lista.innerHTML = `
      <button type="button" data-demo-email="super@plataforma.com" data-demo-password="Super1234">
        <span>Plataforma</span><span class="muted">super@plataforma.com</span>
      </button>`;
  }
}

if (pagina === 'registro' && !negocio) {
  mostrarError('Para crear una cuenta entra por el enlace de tu negocio (/b/tu-negocio/registro).');
  if (boton) {
    boton.disabled = true;
  }
}

/* ---------------- Utilidades ---------------- */

function mostrarError(texto) {
  error.textContent = texto;
  error.hidden = false;
}

function limpiarError() {
  error.textContent = '';
  error.hidden = true;
}

function valor(id) {
  const campo = document.querySelector(`#${id}`);
  return campo ? campo.value.trim() : '';
}

/* ---------------- Envío ---------------- */

async function enviar(evento) {
  evento.preventDefault();
  limpiarError();

  if (!formulario.reportValidity()) {
    return;
  }

  boton.disabled = true;
  boton.textContent = textoDeEspera();

  try {
    if (pagina === 'recuperar') {
      /* El backend siempre responde 200 exista o no el correo. Por eso aqui no
         se dice nada distinto: avisar de que el correo esta registrado seria
         confirmar que esa cuenta existe. */
      const respuesta = await post('/api/auth/forgot-password', { email: valor('email') });
      aviso(respuesta?.mensaje || 'Si el correo está registrado, te hemos enviado un enlace.', 'ok');
      formulario.reset();
      return;
    }

    if (pagina === 'reset') {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      if (!token) {
        mostrarError(
          'El enlace no es válido o ya se ha usado. Pide uno nuevo desde «He olvidado mi contraseña».'
        );
        return;
      }
      const respuesta = await post('/api/auth/reset-password', {
        token,
        password: valor('password'),
        confirmPassword: valor('confirmPassword'),
      });
      aviso(respuesta?.mensaje || 'Contraseña actualizada. Ya puedes iniciar sesión.', 'ok');
      window.setTimeout(() => {
        window.location.assign(negocio ? `/b/${negocio}/login` : '/login');
      }, 1400);
      return;
    }

    const ruta = pagina === 'registro' ? '/api/auth/register' : '/api/auth/login';
    const sesion = await post(ruta, cuerpoDelFormulario());

    guardarTokens(sesion);
    guardarNegocio(sesion.negocio ? sesion.negocio.slug : negocio);
    window.location.assign(panelDe(sesion.user.role));
  } catch (problema) {
    mostrarError(textoError(problema));
  } finally {
    boton.disabled = false;
    boton.textContent = textoDeBoton();
  }
}

function textoDeEspera() {
  return (
    { registro: 'Creando cuenta…', login: 'Comprobando…', recuperar: 'Enviando…', reset: 'Actualizando…' }[
      pagina
    ] || 'Enviando…'
  );
}

function textoDeBoton() {
  return (
    { registro: 'Crear cuenta', login: 'Entrar', recuperar: 'Enviar enlace', reset: 'Actualizar contraseña' }[
      pagina
    ] || 'Enviar'
  );
}

/** El cuerpo que espera cada endpoint. Solo se manda lo que esta rellenado. */
function cuerpoDelFormulario() {
  if (pagina === 'registro') {
    const cuerpo = {
      nombre: valor('nombre'),
      documento: valor('documento'),
      fechaNacimiento: valor('fechaNacimiento'),
      email: valor('email'),
      password: valor('password'),
      confirmPassword: valor('confirmPassword'),
      negocio,
      emailOptIn: Boolean(document.querySelector('#emailOptIn')?.checked),
    };

    // Los opcionales se omiten en vez de mandar "" o null: el servidor los
    // distingue de un valor vacio real al validar.
    const telefono = valor('telefono');
    const direccion = valor('direccion');
    if (telefono) {
      cuerpo.telefono = telefono;
    }
    if (direccion) {
      cuerpo.direccion = direccion;
    }
    return cuerpo;
  }

  return { email: valor('email'), password: valor('password'), negocio: negocio || undefined };
}

formulario.addEventListener('submit', (evento) => {
  void enviar(evento);
});

/* ---------------- Cuentas de ejemplo ---------------- */

/* Los botones de ejemplo rellenan el formulario. Se engancha UN listener en el
   documento en vez de uno por boton, porque el bloque se reescribe mas arriba
   cuando la puerta es la de la plataforma: los botones nuevos se crearian
   despues de recorrer el DOM y no quedarian escuchando. La delegacion los
   pilla igual. */
document.addEventListener('click', (evento) => {
  const botonDemo = evento.target.closest('[data-demo-email]');
  if (!botonDemo) {
    return;
  }
  evento.preventDefault();
  document.querySelector('#email').value = botonDemo.dataset.demoEmail;
  document.querySelector('#password').value = botonDemo.dataset.demoPassword;
  limpiarError();
  if (boton) {
    boton.focus();
  }
});

/* Mostrar/ocultar contraseña: en móvil el teclado virtual tapa media pantalla y
   uno acaba escribiendo la contraseña a ciegas si no puede ver lo que teclea. */
for (const toggle of document.querySelectorAll('[data-ver-clave]')) {
  toggle.addEventListener('click', () => {
    const campo = document.querySelector(`#${toggle.dataset.verClave}`);
    if (!campo) {
      return;
    }
    const visible = campo.type === 'text';
    campo.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? 'Ver' : 'Ocultar';
    toggle.setAttribute('aria-label', visible ? 'Ver contraseña' : 'Ocultar contraseña');
  });
}
