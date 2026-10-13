/**
 * Piezas de interfaz compartidas por todas las paginas: navegacion (sidebar en
 * escritorio y barra inferior en movil), avisos, dialogos, confirmaciones,
 * tablas, insignias y esqueletos de carga.
 *
 * Aqui no hay reglas de negocio: solo presentacion y eventos. Quien llama es el
 * que decide que se puede hacer.
 */
import {
  ESTADOS_CITA,
  conectarSalir,
  errorDeCampo,
  esc,
  fecha,
  iniciales,
  insignia as insigniaHtml,
  textoError,
} from './api.js';

/* ---------------- Iconos ---------------- */

/* Iconos en SVG en linea y no en una fuente: sin CDN, sin peticion extra y
   heredan el color del texto, que es lo que hace falta para el estado activo
   de la navegacion. */
export const ICONOS = {
  panel: '<path d="M3 3h7v8H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 15h7v6H3z"/>',
  citas: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  calendario:
    '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18M8 14h3M14 14h3M8 17h3"/>',
  tareas:
    '<path d="M9 4h11M9 12h11M9 20h11"/><path d="M3 4l1.5 1.5L7 3M3 12l1.5 1.5L7 11M3 20l1.5 1.5L7 19"/>',
  clientes:
    '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  borrar: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  cerrar: '<path d="M18 6L6 18M6 6l12 12"/>',
  atras: '<path d="M15 18l-6-6 6-6"/>',
  adelante: '<path d="M9 18l6-6-6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  aviso: '<path d="M12 3l9.5 17H2.5z"/><path d="M12 10v4M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  vacio: '<path d="M3 7l9 5 9-5M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l2-3h14l2 3"/>',
  luna: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  negocios: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M10 21v-6h4v6"/>',
  informes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><rect x="2" y="2" width="20" height="20" rx="2"/>',
};

export function icono(nombre, extra = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${ICONOS[nombre] || ''}</svg>`;
}

/* ---------------- Navegacion ---------------- */

/* El menu se declara UNA vez por pagina y se pinta en los dos sitios: barra
   inferior en movil y sidebar en escritorio. Mantener dos listas sueltas hacia
   que se desincronicen en cuanto se anade una pantalla. */
const MENUS = {
  admin: [
    { ruta: '/admin', texto: 'Panel', icono: 'panel' },
    { ruta: '/admin/citas', texto: 'Citas', icono: 'citas' },
    { ruta: '/admin/calendario', texto: 'Calendario', icono: 'calendario' },
    { ruta: '/admin/tareas', texto: 'Tareas', icono: 'tareas' },
    { ruta: '/admin/clientes', texto: 'Clientes', icono: 'clientes' },
  ],
  /* v2 anade Informes y Equipo. Con siete destinos la barra inferior de movil ya no
     cabe a 44px por icono con etiqueta, asi que Equipo NO va en la barra: se llega
     desde el panel o desde Informes, y el sidebar si lo lista entero. */
  adminAmplio: [
    { ruta: '/admin', texto: 'Panel', icono: 'panel' },
    { ruta: '/admin/citas', texto: 'Citas', icono: 'citas' },
    { ruta: '/admin/calendario', texto: 'Calendario', icono: 'calendario' },
    { ruta: '/admin/tareas', texto: 'Tareas', icono: 'tareas' },
    { ruta: '/admin/clientes', texto: 'Clientes', icono: 'clientes' },
    { ruta: '/admin/informes', texto: 'Informes', icono: 'informes' },
  ],
  cliente: [
    { ruta: '/cliente', texto: 'Panel', icono: 'panel' },
    { ruta: '/cliente/citas', texto: 'Mis citas', icono: 'citas' },
    { ruta: '/cliente/perfil', texto: 'Mi perfil', icono: 'perfil' },
  ],
  /* Con cuatro destinos la barra inferior ya va justa. Ajustes no entra en ella:
     son una pantalla de uso raro (una vez cada varios meses) y meterla obliga a
     encoger los iconos de las tres que se usan todos los dias. Se llega desde el
     perfil, y el sidebar si la lista entera. */
  clienteAmplio: [
    { ruta: '/cliente', texto: 'Panel', icono: 'panel' },
    { ruta: '/cliente/citas', texto: 'Mis citas', icono: 'citas' },
    { ruta: '/cliente/perfil', texto: 'Mi perfil', icono: 'perfil' },
  ],
  super: [{ ruta: '/super', texto: 'Negocios', icono: 'negocios' }],
};

/*
 * Destinos que van SOLO en el sidebar.
 *
 * La barra inferior de movil esta limitada: a partir de seis elementos los iconos
 * se encogen por debajo de los 44px de zona tactil, que es el minimo que el dedo
 * acierta. Estas pantallas son ademas de uso poco frecuente (informes, equipo,
 * ajustes), asi que no compiten con las de todos los dias por ese sitio.
 *
 * En escritorio el sidebar las muestra y se llega igual de bien.
 */
const EXTRAS = {
  admin: [{ ruta: '/admin/equipo', texto: 'Equipo', icono: 'clientes' }],
  adminAmplio: [{ ruta: '/admin/equipo', texto: 'Equipo', icono: 'clientes' }],
  cliente: [{ ruta: '/cliente/ajustes', texto: 'Ajustes', icono: 'perfil' }],
  clienteAmplio: [{ ruta: '/cliente/ajustes', texto: 'Ajustes', icono: 'perfil' }],
};

/* Con cinco destinos la barra inferior se queda sin sitio para el nombre largo
   de cada uno. En el sidebar hay hueco de sobra, asi que ahi se conserva la
   etiqueta entera. */
const CORTO_MOVIL = {
  '/cliente/citas': 'Citas',
  '/cliente/perfil': 'Perfil',
};

/** Marca el enlace activo comparando con la ruta real, no con un atributo. */
function esActivo(destino) {
  const actual = window.location.pathname;
  return destino === actual || (destino !== '/' && actual.startsWith(`${destino}/`));
}

/**
 * Pinta la navegacion, el nombre del usuario y el boton de salir.
 * @param {object} sesion  - lo que devuelve /api/auth/me.
 * @param {string} rolMenu - "admin" | "cliente" | "super"
 */
export function montarApp(sesion, rolMenu) {
  const enlaces = MENUS[rolMenu] || MENUS.cliente;

  /* Barra inferior (movil y tablet) */
  const tabbar = document.querySelector('#tabbar');
  if (tabbar) {
    tabbar.innerHTML = enlaces
      .map(
        (enlace) => `
        <a class="tabbar-item${esActivo(enlace.ruta) ? ' active' : ''}" href="${enlace.ruta}"
           ${esActivo(enlace.ruta) ? 'aria-current="page"' : ''}>
          ${icono(enlace.icono)}
          <span>${esc(CORTO_MOVIL[enlace.ruta] || enlace.texto)}</span>
        </a>`
      )
      .join('');
  }

  /* Sidebar (escritorio). Aqui caben mas destinos que en la barra: no hay limite
     de iconos y las etiquetas pueden ser largas. Por eso el sidebar lleva tambien
     las pantallas que la barra deja fuera (Informes, Equipo, Ajustes). */
  const sidebar = document.querySelector('#sidebar-nav');
  if (sidebar) {
    const conExtras = [...enlaces, ...(EXTRAS[rolMenu] || [])];

    sidebar.innerHTML = conExtras
      .map(
        (enlace) => `
        <a class="sidebar-link${esActivo(enlace.ruta) ? ' active' : ''}" href="${enlace.ruta}"
           ${esActivo(enlace.ruta) ? 'aria-current="page"' : ''}>
          ${icono(enlace.icono)}
          <span>${esc(enlace.texto)}</span>
        </a>`
      )
      .join('');
  }

  /* Identidad: nombre y rol. Con el error temporal el nombre va vacio, pero el
     resto de la pagina sigue siendo usable.

     Se rellenan TODOS los elementos con el atributo, no uno por id: el nombre
     aparece en la cabecera de movil y en el pie del sidebar de escritorio, y
     los dos tienen que decir lo mismo siempre. */
  const nombre = sesion?.user?.nombre || '';

  for (const destino of document.querySelectorAll('[data-nombre-usuario]')) {
    destino.textContent = nombre;
  }

  for (const insigniaRol of document.querySelectorAll('[data-insignia-rol]')) {
    insigniaRol.textContent = '';
    insigniaRol.className = 'badge';
    if (sesion?.user?.role) {
      insigniaRol.textContent = rotuloDeRol(sesion.user.role);
      insigniaRol.classList.add(claseDeRol(sesion.user.role));
    }
  }

  const marca = document.querySelector('[data-marca-negocio]');
  if (marca) {
    marca.textContent = sesion?.negocio?.nombre || 'Agenda26';
  }

  const subtitulo = document.querySelector('[data-subtitulo-negocio]');
  if (subtitulo) {
    subtitulo.textContent = sesion?.negocio?.nombre || 'Agenda26';
  }

  conectarSalir();
  montarTema(sesion?.settings);
}

function rotuloDeRol(rol) {
  return (
    { SUPERADMIN: 'Plataforma', ADMIN: 'Administracion', STAFF: 'Profesional', CLIENT: 'Cliente' }[rol] || ''
  );
}

function claseDeRol(rol) {
  return (
    { SUPERADMIN: 'badge-admin', ADMIN: 'badge-admin', STAFF: 'badge-staff', CLIENT: 'badge-client' }[rol] ||
    'badge-inactive'
  );
}

/* ---------------- Tema claro / oscuro ---------------- */

const CLAVE_TEMA = 'agenda26_tema';

/**
 * El tema guardado manda sobre el del sistema, pero solo si el visitante lo
 * ha elegido. "auto" limpia el atributo y vuelve a mandar prefers-color-scheme.
 */
function montarTema(settings) {
  /*
   * El `localStorage` va con try/catch y no a pelo.
   *
   * En modo privado `getItem` lanza. Como esta funcion se llama desde
   * `montarApp`, el throw abortaba el montaje entero: sin navegacion, sin nombre y
   * sin boton de salir, en una pagina que por lo demas funciona. El propio
   * `index.html` ya lo hace asi ("Modo privado sin localStorage").
   */
  let guardado = null;
  try {
    guardado = window.localStorage.getItem(CLAVE_TEMA);
  } catch {
    guardado = null;
  }

  aplicarTema(guardado || settings?.theme || 'auto');

  for (const boton of document.querySelectorAll('[data-tema]')) {
    boton.addEventListener('click', () => {
      const siguiente = boton.dataset.tema === 'auto' ? 'auto' : boton.dataset.tema;
      try {
        window.localStorage.setItem(CLAVE_TEMA, siguiente);
      } catch {
        /* El tema cambia en esta pagina, aunque no se recuerde al recargar. */
      }
      aplicarTema(siguiente);
    });
  }
}

function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'auto') {
    raiz.removeAttribute('data-theme');
  } else {
    raiz.setAttribute('data-theme', tema);
  }

  for (const boton of document.querySelectorAll('[data-tema]')) {
    const activo = boton.dataset.tema === (tema || 'auto');
    boton.setAttribute('aria-pressed', String(activo));
  }
}

/* ---------------- Barras de avisos y confirmacion ---------------- */

/* La pila de toasts y el dialogo de confirmacion se crean solos la primera
   vez que se usan. Todas las paginas comparten esta pieza; duplicar el marcado
   en quince HTML era pedir que uno se quede sin actualizar. */
let pilaAvisos = null;
let dialogoConfirmacion = null;

/**
 * Crea la pila de toasts si no existe.
 * @returns {HTMLElement}
 */
function pila() {
  if (!pilaAvisos) {
    pilaAvisos = document.createElement('div');
    pilaAvisos.className = 'toast-stack';
    pilaAvisos.setAttribute('role', 'status');
    pilaAvisos.setAttribute('aria-live', 'polite');
    document.body.appendChild(pilaAvisos);
  }
  return pilaAvisos;
}

/**
 * Aviso breve. Los errores se quedan mas tiempo que los exitos: un "guardado"
 * se lee de un vistazo, un fallo obliga a leerlo entero.
 *
 * @param {string} mensaje
 * @param {"info"|"error"|"ok"} [tipo]
 * @returns {Function} funcion para cerrar el aviso antes de tiempo.
 */
export function aviso(mensaje, tipo = 'info') {
  const destino = pila();
  const elemento = document.createElement('div');
  elemento.className = `toast ${tipo}`;
  elemento.textContent = mensaje;
  elemento.title = 'Toca para cerrar';
  destino.appendChild(elemento);

  const quitar = () => elemento.remove();
  window.setTimeout(quitar, tipo === 'error' ? 6000 : 3200);

  // Se puede cerrar antes de tiempo sin esperar al temporizador.
  elemento.addEventListener('click', quitar);
  return quitar;
}

/** El aviso de error de la API con su texto ya calculado. */
export function avisoDeError(error) {
  return aviso(textoError(error), 'error');
}

/* ---------------- Dialogos ---------------- */

/**
 * Abre un <dialog> y lo devuelve para poder rellenar y escuchar.
 *
 * `showModal()` lanza `InvalidStateError` si el dialogo ya esta abierto, asi que
 * el `if` no es cosmetico: sin el, un segundo `abrirDialogo` sobre el mismo
 * elemento tumba la funcion que lo llamaba y deja el modal a medias. El try/catch
 * es la red por si el dialogo se abrio justo entre el `if` y la llamada.
 */
export function abrirDialogo(id) {
  const dialogo = document.querySelector(`#${id}`);
  if (!dialogo) {
    return null;
  }
  if (!dialogo.open) {
    try {
      dialogo.showModal();
    } catch {
      /// Ya abierto en modal: se sigue, que es justo lo que se queria.
    }
  }
  return dialogo;
}

export function cerrarDialogo(id) {
  document.querySelector(`#${id}`)?.close();
}

/**
 * Conecta los botones de cerrar de un dialogo. Todos usan data-cerrar-dialogo,
 * asi que un solo enganche por pagina los cubre todos y no hay que repetirlo
 * en cada formulario.
 */
export function conectarCierres() {
  document.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-cerrar-dialogo]');
    if (boton) {
      boton.closest('dialog')?.close();
      return;
    }
    // Clic en el fondo (la::backdrop) cierra: es lo que espera el dedo, pero
    // solo si el clic no ha empezado dentro de la caja.
    const dialogo = evento.target.closest('dialog');
    if (dialogo && evento.target === dialogo) {
      dialogo.close();
    }
  });
}

/* ---------------- Confirmacion ---------------- */

/**
 * Confirmacion reutilizable. Resuelve a true si el usuario acepta. Se usa para
 * borrar, no para decisiones de negocio.
 *
 * El dialogo se construye la primera vez: quince HTML con el mismo bloque de
 * confirmacion son quince sitios donde se puede quedar desactualizado.
 */
export function confirmar({ titulo, texto, aviso: textoAviso, textoBoton = 'Eliminar' }) {
  return new Promise((resolver) => {
    const dialogo = crearConfirmacion();

    dialogo.querySelector('#confirm-title').textContent = titulo;
    dialogo.querySelector('#confirm-text').textContent = texto;
    dialogo.querySelector('#confirm-aviso').textContent = textoAviso || '';
    const aceptar = dialogo.querySelector('#accept-confirm');
    aceptar.textContent = textoBoton;
    const error = dialogo.querySelector('#confirm-message');
    error.textContent = '';
    error.classList.remove('error');

    const cerrar = () => {
      dialogo.close();
      dialogo.removeEventListener('close', alCerrar);
      aceptar.removeEventListener('click', alAceptar);
      dialogo.querySelector('#cancel-confirm').removeEventListener('click', cancelar);
    };
    const cancelar = () => dialogo.close();
    const alAceptar = () => {
      cerrar();
      resolver(true);
    };
    const alCerrar = () => {
      aceptar.removeEventListener('click', alAceptar);
      resolver(false);
    };

    aceptar.addEventListener('click', alAceptar);
    dialogo.querySelector('#cancel-confirm').addEventListener('click', cancelar);
    dialogo.addEventListener('close', alCerrar);
    dialogo.showModal();
  });
}

/**
 * Crea el dialogo de confirmacion la primera vez que hace falta. Se guarda en
 * una variable para que las siguientes llamadas reutilicen el mismo elemento.
 * @returns {HTMLDialogElement}
 */
function crearConfirmacion() {
  if (dialogoConfirmacion) {
    return dialogoConfirmacion;
  }

  const elemento = document.createElement('dialog');
  elemento.className = 'modal modal--small';
  elemento.id = 'confirm-dialog';
  elemento.setAttribute('aria-labelledby', 'confirm-title');
  elemento.innerHTML = `
    <div class="modal-body">
      <div class="modal-head">
        <h2 id="confirm-title">Confirmar</h2>
        <button class="icon-btn" type="button" data-cerrar-dialogo aria-label="Cerrar">×</button>
      </div>
      <p class="confirm-text" id="confirm-text"></p>
      <p class="confirm-warn" id="confirm-aviso"></p>
      <p class="confirm-text" id="confirm-message" role="status" style="color:var(--danger-ink)"></p>
      <div class="modal-actions">
        <button class="btn btn-quiet" id="cancel-confirm" type="button">Cancelar</button>
        <button class="btn btn-danger" id="accept-confirm" type="button">Aceptar</button>
      </div>
    </div>`;

  document.body.appendChild(elemento);
  dialogoConfirmacion = elemento;
  return elemento;
}

/** Muestra un error dentro del dialogo de confirmacion, sin cerrarlo. */
export function errorEnConfirmacion(texto) {
  const destino = document.querySelector('#confirm-message');
  if (destino) {
    destino.textContent = texto;
    destino.classList.add('error');
  }
}

/* ---------------- Pregunta con texto ---------------- */

let dialogoPregunta = null;

/**
 * Pide un dato de texto antes de continuar.
 *
 * Cancelar, rechazar y marcar una ausencia exigen un motivo: sin el, la pregunta
 * de "por que se cancelan las citas" no tiene respuesta y la metrica de motivos
 * se llena siempre de "Sin especificar". Este es el dialogo que pide ese motivo.
 *
 * Devuelve el texto escrito, o `null` si se cancela o se deja vacio.
 *
 * @param {{titulo: string, texto?: string, placeholder?: string, valor?: string,
 *          textoBoton?: string, obligatorio?: boolean}} opciones
 */
export function preguntar({
  titulo,
  texto = '',
  placeholder = '',
  valor = '',
  textoBoton = 'Guardar',
  obligatorio = true,
}) {
  return new Promise((resolver) => {
    if (!dialogoPregunta) {
      const elemento = document.createElement('dialog');
      elemento.className = 'modal modal--small';
      elemento.id = 'preguntar-dialog';
      elemento.innerHTML = `
        <div class="modal-body">
          <div class="modal-head">
            <h2 id="preguntar-title"></h2>
            <button class="icon-btn" type="button" data-cerrar-dialogo aria-label="Cerrar">&times;</button>
          </div>
          <p class="confirm-text" id="preguntar-texto"></p>
          <label class="field">
            <span id="preguntar-etiqueta">Motivo</span>
            <textarea id="preguntar-input" rows="3" maxlength="500"></textarea>
          </label>
          <p class="confirm-warn" id="preguntar-error" role="status" style="color:var(--danger-ink)"></p>
          <div class="modal-actions">
            <button class="btn btn-quiet" id="preguntar-cancelar" type="button">Cancelar</button>
            <button class="btn btn-primary" id="preguntar-aceptar" type="button"></button>
          </div>
        </div>`;
      document.body.appendChild(elemento);
      dialogoPregunta = elemento;
    }

    const dialogo = dialogoPregunta;
    const input = dialogo.querySelector('#preguntar-input');
    const error = dialogo.querySelector('#preguntar-error');
    const aceptar = dialogo.querySelector('#preguntar-aceptar');

    dialogo.querySelector('#preguntar-title').textContent = titulo;
    dialogo.querySelector('#preguntar-texto').textContent = texto;
    input.placeholder = placeholder;
    input.value = valor;
    aceptar.textContent = textoBoton;
    error.textContent = '';
    input.removeAttribute('aria-invalid');

    const limpiar = () => {
      dialogo.close();
      aceptar.removeEventListener('click', alAceptar);
      dialogo.querySelector('#preguntar-cancelar').removeEventListener('click', cancelar);
      input.removeEventListener('keydown', alTeclado);
      dialogo.removeEventListener('close', alCerrar);
    };

    const devolver = (resultado) => {
      limpiar();
      resolver(resultado);
    };

    const cancelar = () => devolver(null);
    const alCerrar = () => devolver(null);
    const alAceptar = () => {
      const escrito = input.value.trim();
      if (obligatorio && !escrito) {
        error.textContent = 'Escribe el motivo: es lo que queda registrado.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      devolver(escrito || null);
    };
    /// Enter acepta, Shift+Enter salta de linea. Es lo que se espera de un textarea.
    const alTeclado = (evento) => {
      if (evento.key === 'Enter' && !evento.shiftKey) {
        evento.preventDefault();
        alAceptar();
      }
    };

    aceptar.addEventListener('click', alAceptar);
    dialogo.querySelector('#preguntar-cancelar').addEventListener('click', cancelar);
    input.addEventListener('keydown', alTeclado);
    dialogo.addEventListener('close', alCerrar);
    dialogo.showModal();
    input.focus();
  });
}

/* ---------------- Errores en formularios ---------------- */

/**
 * Vuelca los `details` de la API sobre el formulario: cada mensaje va a su
 * campo. El `error` general se queda en la barra superior del formulario, que
 * es donde se lee sin tener que buscar.
 */
export function marcarErrores(formulario, error, { general = null } = {}) {
  limpiarErrores(formulario);

  const detalles = Array.isArray(error?.detalles) ? error.detalles : [];
  for (const detalle of detalles) {
    const mensaje = errorDeCampo(error, detalle.field);
    if (!mensaje) {
      continue;
    }
    const campo = formulario?.elements.namedItem(detalle.field);
    if (!campo) {
      continue;
    }
    campo.setAttribute('aria-invalid', 'true');
    const etiqueta = campo.closest('.field') || campo.parentElement;
    const destino = etiqueta?.querySelector('.field-error') || crearAvisoDeCampo(etiqueta);
    if (destino) {
      destino.textContent = mensaje;
    }
  }

  if (general) {
    general.textContent = error?.message || textoError(error);
  }
}

/** Limpia los marcas de error antes de reintentar un envio. */
export function limpiarErrores(formulario) {
  if (!formulario) {
    return;
  }
  for (const campo of formulario.querySelectorAll('[aria-invalid]')) {
    campo.removeAttribute('aria-invalid');
  }
  for (const destino of formulario.querySelectorAll('.field-error')) {
    destino.textContent = '';
  }
}

/** Anade el <small class="field-error"> debajo de un campo si no lo tiene. */
function crearAvisoDeCampo(contenedor) {
  if (!contenedor) {
    return null;
  }
  const aviso = document.createElement('small');
  aviso.className = 'field-error';
  contenedor.appendChild(aviso);
  return aviso;
}

/** Pinta el mensaje de estado bajo un formulario (exito o error). */
export function mensaje(elemento, texto, esError = false) {
  if (!elemento) {
    return;
  }
  elemento.textContent = texto;
  elemento.classList.toggle('error', esError);
  elemento.classList.toggle('form-error', esError);
}

/* ---------------- Piezas de render ---------------- */

export function avatar(nombre, grande = false) {
  return `<span class="avatar${grande ? ' avatar-lg' : ''}" aria-hidden="true">${esc(iniciales(nombre))}</span>`;
}

/**
 * Estado vacio. Siempre con texto: un hueco en blanco no explica si no hay
 * datos, si hay un error o si la pantalla se ha quedado a medias.
 */
export function vacio(titulo, detalle, conIcono = true) {
  return `
    <div class="empty">
      ${conIcono ? icono('vacio') : ''}
      <strong>${esc(titulo)}</strong>
      ${detalle ? `<span>${esc(detalle)}</span>` : ''}
    </div>`;
}

/** Ficha de datos en modo solo lectura, el formato del dialogo de detalle. */
/**
 * Ficha de datos en modo solo lectura, el formato del dialogo de detalle.
 *
 * "Sin datos" es para lo que NO esta: `null`, `undefined` y la cadena vacia. Un
 * `0` es un dato de verdad (un precio, una cantidad, un contador) y antes se
 * escondia detras de "Sin datos" por usar el valor como condicion.
 */
export function dato(etiqueta, valor, ancho = false) {
  const sinDato = valor === null || valor === undefined || valor === '';
  const contenido = sinDato ? '<em>Sin datos</em>' : esc(valor);
  return `
    <div class="detail-item${ancho ? ' detail-item-wide' : ''}">
      <span>${esc(etiqueta)}</span>
      <strong>${contenido}</strong>
    </div>`;
}

/**
 * Celda de tabla con su rotulo. En movil el rotulo es la columna invisible.
 *
 * `contenido` se mete en crudo porque su uso es justamente componer HTML
 * (`celda("Cliente", `<strong>${esc(nombre)}</strong>`)`), y quien lo pasa es
 * codigo de la propia aplicacion. Lo que NO se puede meter sin escapar es el
 * `class`: si algun dia travelsa un dato del servidor y ese valor trae una comilla
 * cerrada, deja de ser una clase y pasa a ser inyeccion de atributos.
 *
 * Por eso la clase se filtra a un nombre de clase y no se interpola tal cual: se
 * descarta cualquier cosa con espacios, comillas o parentesis angulares.
 */
export function celda(rotulo, contenido, clase = '') {
  return `<td data-label="${esc(rotulo)}"${claseSegura(clase) ? ` class="${claseSegura(clase)}"` : ''}>${contenido}</td>`;
}

/**
 * Devuelve la clase solo si es un nombre de clase de verdad.
 *
 * Una clase viene casi siempre de una constante de la propia interfaz, pero el
 * `class="..."` es un atributo HTML: un valor con una comilla cerrada ya no es
 * una clase, es inyeccion de atributos. Se acepta unicamente lo que parece una
 * clase y se descarta el resto en vez de interpolarlo.
 */
function claseSegura(clase) {
  const valor = String(clase || '');
  return valor && /^[A-Za-z0-9_-]+$/.test(valor) ? valor : '';
}

/**
 * Tabla responsive. En movil cada fila se convierte en una tarjeta y cada
 * celda se rotula con su data-label; en escritorio vuelve a ser tabla normal.
 *
 * @param {Array<{titulo:string, clase?:string}>} columnas
 * @param {Array<Array<string>>} filas  - celdas ya en HTML, sin <td>.
 * @param {{textoVacio?: string}} opciones - HTML a mostrar si no hay filas.
 */
export function tabla(columnas, filas, { textoVacio = null } = {}) {
  if (filas.length === 0) {
    return textoVacio || vacio('Nada que mostrar', 'No hay registros con estos filtros.');
  }

  return `
    <div class="table-wrap">
      <table class="tabla">
        <thead>
          <tr>${columnas.map((c) => `<th${claseSegura(c.clase) ? ` class="${claseSegura(c.clase)}"` : ''}>${esc(c.titulo)}</th>`).join('')}</tr>
        </thead>
        <tbody>${filas.map((fila) => `<tr>${fila.join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/** Esqueleto de carga para una lista de tarjetas. */
export function esqueleto(cuantas = 3, clase = 'skeleton-card') {
  return Array.from({ length: cuantas }, () => `<div class="skeleton ${clase}"></div>`).join('');
}

/** Esqueleto de carga para un bloque de texto. */
export function esqueletoLineas(cuantas = 3) {
  return `<div class="skeleton" style="padding:1rem">
    ${Array.from({ length: cuantas }, () => '<div class="skeleton-line"></div>').join('')}
  </div>`;
}

/** Estado de error de carga: dice qué pasó y deja reintentar. */
export function errorDeCarga(mensaje = 'No se pudo cargar la información.') {
  return `
    <div class="empty">
      ${icono('aviso')}
      <strong>${esc(mensaje)}</strong>
      <span>Comprueba la conexion y vuelve a intentarlo.</span>
    </div>`;
}

/** Fila de cita para listas: la usan el panel, el listado y el calendario. */
export function filaCita(cita, { conAcciones = false, acento = null } = {}) {
  const color =
    acento ||
    { PENDING: 'var(--warning)', COORDINATED: 'var(--success)', COMPLETED: 'var(--muted)' }[cita.status] ||
    'var(--border-strong)';

  return `
    <article class="row-card${conAcciones ? ' row-card--clickable' : ''}" data-id="${cita.id}" style="--accent:${color}">
      <div class="row-main">
        <span class="row-title">${esc(cita.task?.title || cita.title || 'Cita')}</span>
        <span class="row-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || '')}–${esc(cita.availability?.endTime || '')}
          ${cita.task?.category?.name ? ` · ${esc(cita.task.category.name)}` : ''}
        </span>
        ${cita.note ? `<p class="row-note">${esc(cita.note)}</p>` : ''}
      </div>
      ${insigniaHtml(cita.status, ESTADOS_CITA)}
      ${conAcciones ? '<div class="row-actions"></div>' : ''}
    </article>`;
}

/**
 * Boton de recordatorio por WhatsApp. Solo tiene sentido en citas ya
 * confirmadas y si el cliente tiene telefono en su ficha.
 */
export function botonRecordatorio(cita) {
  if (cita.status !== 'COORDINATED' || !cita.client?.telefono) {
    return '';
  }

  let numero = String(cita.client.telefono).replace(/\D/g, '');
  if (!numero) {
    return '';
  }
  // Uruguay: prefijo 598. Los moviles locales empiezan por 09, pero al
  // escribirlos en internacional se les quita ese 0 inicial.
  if (!numero.startsWith('598')) {
    numero = `598${numero.replace(/^0+/, '')}`;
  }

  const texto =
    `¡Hola ${cita.client.nombre}! 👋 Te recordamos tu cita de "${cita.task?.title || 'Cita'}" ` +
    `el ${fecha(cita.availability?.date)} · ${cita.availability?.startTime || ''}–${cita.availability?.endTime || ''}. ` +
    `¡Te esperamos!`;

  return `<a class="btn btn-quiet btn-sm" data-wpp href="https://wa.me/${numero}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">📣 Recordatorio</a>`;
}

/** Marca de estado ya importada, reexportada para no repetir imports. */
export { insigniaHtml as insignia };

/* ---------------- Botones de una fila ---------------- */

/**
 * Conecta las filas pulsables de una lista. Se pone tabindex y role a mano
 * porque el listado se pinta con innerHTML y el HTML plano no admite
 * delegacion: sin esto, la lista solo se podria abrir con raton.
 */
export function conectarFilas(contenedor, alPulsar) {
  if (!contenedor) {
    return;
  }
  for (const fila of contenedor.querySelectorAll('[data-id]')) {
    fila.classList.add('row-card--clickable');
    fila.setAttribute('tabindex', '0');
    fila.setAttribute('role', 'button');
    const abrir = () => alPulsar(Number(fila.dataset.id), fila);
    fila.addEventListener('click', (evento) => {
      // Los botones y enlaces internos (recordatorio, editar…) gestionan su
      // propio clic: sin esta guarda, pulsarlos abriria la ficha detras.
      if (evento.target.closest('button, a')) {
        return;
      }
      abrir();
    });
    fila.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') {
        evento.preventDefault();
        abrir();
      }
    });
  }
}
