/**
 * Listado de tareas del administrador con sus vistas, alta y edición, y las
 * categorías como ventana aparte.
 *
 * La vista por defecto es "Mis tareas" (alcance=propias): las sueltas del
 * administrador. Cada cita registrada genera también una tarea, y esas ya se
 * gestionan en "Citas" y en el calendario, así que en la lista de trabajo se
 * apartan. "Todas" y "De citas" las traen de vuelta.
 */
import {
  ESTADOS_TAREA,
  datosDe,
  del,
  esc,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  insignia,
  post,
  put,
  textoError,
} from '../api.js';
import {
  abrirDialogo,
  aviso,
  confirmar,
  conectarCierres,
  conectarFilas,
  dato,
  esqueleto,
  marcarErrores,
  montarApp,
  vacio,
} from '../ui.js';

const sesion = await exigirSesion(['ADMIN', 'STAFF']);
if (!sesion) {
  throw new Error('sin sesion');
}

montarApp(sesion, 'admin');
conectarCierres();

const parametros = new URLSearchParams(window.location.search);
const filtros = {
  vista: parametros.get('vista') || 'propias',
  estado: '',
  categoryId: '',
  q: '',
};

const lista = document.querySelector('#lista-tareas');
const dialogoTarea = document.querySelector('#tarea-dialog');
const formularioTarea = document.querySelector('#tarea-form');
const errorTarea = document.querySelector('#tarea-error');
const dialogoCategoria = document.querySelector('#categoria-dialog');
const formularioCategoria = document.querySelector('#categoria-form');
const errorCategoria = document.querySelector('#categoria-error');

let categorias = [];
let clientes = [];

/* ---------------- Vistas ---------------- */

/**
 * "propias" es la vista por defecto: las tareas sueltas del administrador. Las
 * que nacen al registrar una cita se gestionan en "Citas", así que en la lista
 * de trabajo no ensucian. "de-citas" las deja a la vista cuando hacen falta.
 */
const VISTAS = {
  propias: { etiqueta: 'Mis tareas', params: { alcance: 'propias' } },
  todas: { etiqueta: 'Todas', params: {} },
  agendadas: { etiqueta: 'Agendadas', params: { alcance: 'propias', filtro: 'agendadas' } },
  'sin-fecha': { etiqueta: 'Sin fecha', params: { alcance: 'propias', filtro: 'sin-fecha' } },
  pendientes: { etiqueta: 'Pendientes', params: { alcance: 'propias', filtro: 'pendientes' } },
  completadas: { etiqueta: 'Completadas', params: { alcance: 'propias', filtro: 'completadas' } },
  'de-citas': { etiqueta: 'De citas', params: { alcance: 'de-citas' } },
};

/* Una vista inventada en la URL cae en la de por defecto en vez de romper. */
if (!VISTAS[filtros.vista]) {
  filtros.vista = 'propias';
}

/** Los contadores de las tarjetas respetan el alcance de la vista activa. */
function alcanceDeLaVista() {
  return VISTAS[filtros.vista].params.alcance || '';
}

function marcarVistaActiva() {
  for (const enlace of document.querySelectorAll('.tabs .tab')) {
    const vista = new URLSearchParams(enlace.href.split('?')[1]).get('vista');
    enlace.classList.toggle('active', vista === filtros.vista);
  }
}

/* ---------------- Carga ---------------- */

async function cargar() {
  marcarVistaActiva();

  const alcance = alcanceDeLaVista();
  const query = new URLSearchParams({ limit: '200' });

  for (const [clave, valor] of Object.entries(VISTAS[filtros.vista].params)) {
    query.set(clave, valor);
  }
  if (filtros.estado) query.set('estado', filtros.estado);
  if (filtros.categoryId) query.set('categoryId', filtros.categoryId);
  if (filtros.q) query.set('q', filtros.q);

  /* Los contadores se cuentan siempre dentro del alcance de la vista, para que
     el "Total" de arriba no sea el de una lista que no se está viendo. */
  const conAlcance = (extra) => {
    const p = new URLSearchParams({ ...(alcance ? { alcance } : {}), ...extra, limit: '1' });
    return `/api/tasks?${p}`;
  };

  let datos;
  try {
    [datos] = await Promise.all([get(`/api/tasks?${query}`), pintarResumen(conAlcance)]);
  } catch (error) {
    lista.innerHTML = '';
    lista.insertAdjacentHTML('beforeend', vacio('No se pudieron cargar las tareas', textoError(error)));
    return;
  }

  /* El "Total" es el de la vista activa: si dijera el de otra, las cifras de
     arriba no corresponderían a lo que hay en pantalla. */
  document.querySelector('#stat-total').textContent = datos?.total ?? '—';

  pintarAvisoDeOcultas(alcance);
  pintar(datos?.items || []);
}

/** Las cuatro tarjetas de arriba. Van aparte porque si fallan no impiden ver
    la lista, que es lo que el usuario vino a hacer. */
async function pintarResumen(conAlcance) {
  try {
    const [sinFecha, pendientes, completadas, deCitas] = await Promise.all([
      get(conAlcance({ filtro: 'sin-fecha' })),
      get(conAlcance({ filtro: 'pendientes' })),
      get(conAlcance({ filtro: 'completadas' })),
      get('/api/tasks?alcance=de-citas&limit=1'),
    ]);

    document.querySelector('#stat-sin-fecha').textContent = sinFecha?.total ?? '—';
    document.querySelector('#stat-pendientes').textContent = pendientes?.total ?? '—';
    document.querySelector('#stat-completadas').textContent = completadas?.total ?? '—';

    ocultasGlobal = deCitas?.total || 0;
  } catch {
    // Las tarjetas se quedan en "—".
  }
}

let ocultasGlobal = 0;

/**
 * Aviso de lo que queda fuera: las tareas que nacen de una cita se ven en
 * "Citas", y aquí sólo se esconden si la vista no es "todas".
 */
function pintarAvisoDeOcultas(alcance) {
  const ocultas = document.querySelector('#ocultas');
  if (alcance === 'propias' && ocultasGlobal > 0) {
    ocultas.hidden = false;
    ocultas.querySelector('span').textContent =
      `${ocultasGlobal} tarea${ocultasGlobal === 1 ? '' : 's'} de citas quedan fuera de esta lista`;
  } else {
    ocultas.hidden = true;
  }
}

function pintar(tareas) {
  lista.innerHTML =
    tareas.length === 0
      ? vacio('Sin tareas', 'Cambia de vista o crea una nueva.')
      : tareas.map(filaTarea).join('');

  conectarFilas(lista, (id) => void abrirDetalle(id));

  /* Los botones de editar y borrar tienen su propio manejador: la fila es
     pulsable y sin esta guarda, pulsarlos abrirían la ficha detrás. */
  lista.addEventListener(
    'click',
    async (evento) => {
      const boton = evento.target.closest('button[data-accion]');
      if (!boton) {
        return;
      }
      const id = Number(boton.closest('[data-id]').dataset.id);
      if (boton.dataset.accion === 'editar') {
        const { tarea } = await get(`/api/tasks/${id}`);
        abrirEditor(tarea);
      }
    },
    // Un solo manejador aunque la lista se repinte mil veces.
    true
  );
}

function filaTarea(tarea) {
  const acento = {
    PENDING: 'var(--primary)',
    IN_PROGRESS: 'var(--warning)',
    COMPLETED: 'var(--success)',
    CANCELLED: 'var(--muted)',
  }[tarea.status];

  const fechaTexto =
    tarea.sinFecha || !tarea.dueDate
      ? '<span class="task-sin-fecha">Sin fecha</span>'
      : `${esc(fecha(tarea.dueDate))}${tarea.dueTime ? ` · ${esc(tarea.dueTime)}` : ''}`;

  return `
    <article class="task-row${tarea.status === 'COMPLETED' ? ' done' : ''}"
             data-id="${tarea.id}" style="--accent:${acento}">
      <span class="mark" aria-hidden="true">${tarea.status === 'COMPLETED' ? '✓' : '•'}</span>
      <div>
        <span class="task-title">${esc(tarea.title)}</span>
        <span class="task-meta">
          ${fechaTexto}
          ${tarea.category ? `<span class="chip">${esc(tarea.category.name)}</span>` : ''}
          ${tarea.client ? `<span class="chip">${esc(tarea.client.nombre)}</span>` : ''}
          ${tarea.citas ? `<span class="chip">${tarea.citas} cita${tarea.citas === 1 ? '' : 's'}</span>` : ''}
        </span>
      </div>
      <div class="task-actions">
        ${insignia(tarea.status, ESTADOS_TAREA)}
        <button class="icon-btn icon-btn-sm" type="button" data-accion="editar" aria-label="Editar tarea">✎</button>
      </div>
    </article>`;
}

/* ---------------- Detalle ---------------- */

async function abrirDetalle(id) {
  const dialogo = abrirDialogo('detalle-dialog');
  if (!dialogo) {
    return;
  }
  let tarea;
  try {
    ({ tarea } = await get(`/api/tasks/${id}`));
  } catch (error) {
    aviso(textoError(error), 'error');
    return;
  }

  dialogo.innerHTML = `
    <div class="modal-body">
      <div class="modal-head">
        <div>
          <p class="eyebrow">Tarea #${tarea.id}</p>
          <h2 id="detalle-title">${esc(tarea.title)}</h2>
          <div class="row-tags">${insignia(tarea.status, ESTADOS_TAREA)}</div>
        </div>
        <button class="icon-btn" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="detail-grid">
        ${dato('Categoría', tarea.category?.name)}
        ${dato('Fecha', tarea.sinFecha || !tarea.dueDate ? 'Sin fecha' : fecha(tarea.dueDate))}
        ${dato('Hora', tarea.dueTime || '')}
        ${dato('Cliente', tarea.client?.nombre)}
        ${dato('Citas', tarea.citas != null ? String(tarea.citas) : '')}
        ${dato('Creada', fechaHora(tarea.createdAt))}
        ${dato('Descripción', tarea.description || '', true)}
      </div>

      <div class="modal-foot">
        <button class="btn btn-primary btn-sm" data-editar type="button">Editar</button>
        <span class="spacer" style="flex:1 1 auto"></span>
        <button class="btn btn-danger btn-sm" data-borrar type="button">Eliminar</button>
      </div>
    </div>`;

  dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
  dialogo.querySelector('[data-editar]').addEventListener('click', () => {
    dialogo.close();
    abrirEditor(tarea);
  });
  dialogo.querySelector('[data-borrar]').addEventListener('click', async () => {
    dialogo.close();
    await borrar(tarea);
  });

  // `abrirDialogo` ya lo abrio con `showModal()`.
}

/* ---------------- Editor de tarea ---------------- */

async function cargarOpciones() {
  /* Cada grupo va por su cuenta: que no haya categorías no puede impedir
     cargar la lista de clientes, y al revés. */
  const [categoriasOk, clientesOk] = await Promise.allSettled([
    get('/api/categories'),
    get('/api/clients?limit=200'),
  ]);

  categorias = categoriasOk.status === 'fulfilled' ? categoriasOk.value.items || [] : [];
  clientes = clientesOk.status === 'fulfilled' ? clientesOk.value.items || [] : [];

  document.querySelector('#tarea-categoria').innerHTML =
    '<option value="">Sin categoría</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join('');

  document.querySelector('#tarea-cliente').innerHTML =
    '<option value="">Sin cliente</option>' +
    clientes.map((cliente) => `<option value="${cliente.id}">${esc(cliente.nombre)}</option>`).join('');

  document.querySelector('#filtro-categoria').innerHTML =
    '<option value="">Todas las categorías</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join('');
}

function abrirEditor(tarea) {
  formularioTarea.reset();
  errorTarea.hidden = true;
  marcarErrores(formularioTarea, null);

  const id = tarea ? tarea.id : '';
  document.querySelector('#tarea-id').value = id;
  document.querySelector('#tarea-dialog-title').textContent = tarea ? 'Editar tarea' : 'Nueva tarea';
  document.querySelector('#tarea-titulo').value = tarea?.title || '';
  document.querySelector('#tarea-descripcion').value = tarea?.description || '';
  document.querySelector('#tarea-categoria').value = tarea?.categoryId || '';
  document.querySelector('#tarea-cliente').value = tarea?.clientId || '';
  document.querySelector('#tarea-fecha').value = tarea?.sinFecha ? '' : tarea?.dueDate || '';
  document.querySelector('#tarea-hora').value = tarea?.dueTime || '';
  document.querySelector('#tarea-estado').value = tarea?.status || 'PENDING';

  abrirDialogo('tarea-dialog');
  document.querySelector('#tarea-titulo').focus();
}

formularioTarea.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorTarea.hidden = true;

  if (!formularioTarea.reportValidity()) {
    return;
  }

  const id = document.querySelector('#tarea-id').value;
  const datos = datosDe(formularioTarea);
  const cuerpo = {
    title: datos.title,
    description: datos.description || null,
    categoryId: datos.categoryId ? Number(datos.categoryId) : null,
    clientId: datos.clientId ? Number(datos.clientId) : null,
    /* Vacío explícito => NULL, que es la vista "sin fecha". */
    dueDate: datos.dueDate || null,
    dueTime: datos.dueTime || null,
    status: datos.status,
  };

  const boton = formularioTarea.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    if (id) {
      await put(`/api/tasks/${id}`, cuerpo);
      aviso('Tarea actualizada.', 'ok');
    } else {
      await post('/api/tasks', cuerpo);
      aviso('Tarea creada.', 'ok');
    }
    dialogoTarea.close();
    await cargar();
  } catch (error) {
    marcarErrores(formularioTarea, error, { general: errorTarea });
  } finally {
    boton.disabled = false;
  }
});

document.querySelector('#nueva-tarea').addEventListener('click', () => abrirEditor(null));

/* ---------------- Borrar ---------------- */

async function borrar(tarea) {
  const ok = await confirmar({
    titulo: 'Eliminar tarea',
    texto: `"${tarea.title}" se eliminará.`,
    aviso: 'Si tiene citas asociadas, también se borran. Esta acción no se puede deshacer.',
    textoBoton: 'Eliminar',
  });
  if (!ok) {
    return;
  }
  try {
    await del(`/api/tasks/${tarea.id}`);
    aviso('Tarea eliminada.', 'ok');
    await cargar();
  } catch (error) {
    aviso(textoError(error), 'error');
  }
}

/* ---------------- Categorías ---------------- */

function abrirEditorCategoria(categoria) {
  formularioCategoria.reset();
  errorCategoria.hidden = true;
  marcarErrores(formularioCategoria, null);

  document.querySelector('#categoria-id').value = categoria ? categoria.id : '';
  document.querySelector('#categoria-dialog-title').textContent = categoria
    ? 'Editar categoría'
    : 'Nueva categoría';
  document.querySelector('#categoria-nombre').value = categoria?.name || '';
  document.querySelector('#categoria-descripcion').value = categoria?.description || '';
  document.querySelector('#categoria-duracion').value = categoria?.durationMin || '';
  document.querySelector('#categoria-precio').value = categoria?.precio ?? '';
  document.querySelector('#categoria-color').value = categoria?.color || '#2f57d4';
  document.querySelector('#categoria-activo').checked = categoria ? categoria.activo !== false : true;

  /* No tiene sentido borrar la última categoría: el servidor la rechazaría y
     el usuario se queda con un error sin entender por qué. */
  document.querySelector('#borrar-categoria').hidden = !categoria || categorias.length <= 1;

  abrirDialogo('categoria-dialog');
  document.querySelector('#categoria-nombre').focus();
}

formularioCategoria.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorCategoria.hidden = true;

  if (!formularioCategoria.reportValidity()) {
    return;
  }

  const id = document.querySelector('#categoria-id').value;
  const datos = datosDe(formularioCategoria);
  const cuerpo = {
    name: datos.name,
    description: datos.description || null,
    activo: datos.activo,
  };
  if (datos.durationMin) {
    cuerpo.durationMin = Number(datos.durationMin);
  }
  if (datos.precio) {
    cuerpo.precio = Number(datos.precio);
  }
  if (datos.color) {
    cuerpo.color = datos.color;
  }

  const boton = formularioCategoria.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    if (id) {
      await put(`/api/categories/${id}`, cuerpo);
      aviso('Categoría actualizada.', 'ok');
    } else {
      await post('/api/categories', cuerpo);
      aviso('Categoría creada.', 'ok');
    }
    dialogoCategoria.close();
    await cargarOpciones();
    await cargar();
  } catch (error) {
    marcarErrores(formularioCategoria, error, { general: errorCategoria });
  } finally {
    boton.disabled = false;
  }
});

document.querySelector('#borrar-categoria').addEventListener('click', async () => {
  const id = Number(document.querySelector('#categoria-id').value);
  const categoria = categorias.find((item) => item.id === id);
  if (!categoria) {
    return;
  }

  const ok = await confirmar({
    titulo: 'Eliminar categoría',
    texto: `Se eliminará la categoría "${categoria.name}".`,
    aviso: 'Las tareas que la usen se quedan sin categoría. No se puede deshacer.',
    textoBoton: 'Eliminar',
  });
  if (!ok) {
    return;
  }

  try {
    await del(`/api/categories/${id}`);
    dialogoCategoria.close();
    aviso('Categoría eliminada.', 'ok');
    await cargarOpciones();
    await cargar();
  } catch (error) {
    aviso(textoError(error), 'error');
  }
});

/**
 * El botón "Categorías" abría antes un prompt con los nombres y números, que
 * no se puede desplazar y obliga a contar en la pantalla. Ahora es una lista
 * real, igual que el resto de la aplicación.
 */
document.querySelector('#gestionar-categorias').addEventListener('click', () => {
  const dialogo = abrirDialogo('categorias-dialog');
  const contenido = document.querySelector('#categorias-lista');

  if (!dialogo || !contenido) {
    return;
  }

  contenido.innerHTML = `
    <div class="modal-head">
      <div>
        <p class="eyebrow">Categorías</p>
        <h2 id="categorias-title">Gestionar categorías</h2>
      </div>
      <button class="icon-btn" data-cerrar type="button" aria-label="Cerrar">×</button>
    </div>

    <div class="stack-list">
      ${
        categorias.length === 0
          ? vacio('Sin categorías', 'Crea la primera para organizar las citas y tareas.')
          : categorias
              .map(
                (categoria) => `
                <div class="client-row">
                  <span class="avatar" style="background:${esc(categoria.color || 'var(--primary-soft)')};color:#fff" aria-hidden="true">
                    ${esc((categoria.name || '?').charAt(0).toUpperCase())}
                  </span>
                  <div class="client-row-main">
                    <span class="client-row-name">${esc(categoria.name)}</span>
                    <span class="client-row-meta">
                      ${categoria.durationMin ? `${categoria.durationMin} min` : 'Sin duración'}
                      ${categoria.precio ? ` · ${esc(categoria.precio)}` : ''}
                      ${categoria.activo === false ? ' · inactiva' : ''}
                    </span>
                  </div>
                  <div class="client-row-actions">
                    <button class="icon-btn icon-btn-sm" type="button" data-editar-categoria="${categoria.id}" aria-label="Editar categoría">✎</button>
                  </div>
                </div>`
              )
              .join('')
      }
    </div>

    <div class="modal-actions">
      <button class="btn btn-primary" id="nueva-categoria" type="button">+ Nueva categoría</button>
    </div>`;

  contenido.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
  contenido.querySelector('#nueva-categoria').addEventListener('click', () => {
    dialogo.close();
    abrirEditorCategoria(null);
  });

  for (const boton of contenido.querySelectorAll('[data-editar-categoria]')) {
    boton.addEventListener('click', () => {
      const categoria = categorias.find((item) => item.id === Number(boton.dataset.editarCategoria));
      dialogo.close();
      if (categoria) {
        abrirEditorCategoria(categoria);
      }
    });
  }

  // `abrirDialogo` ya lo abrio con `showModal()`.
});

/* ---------------- Filtros ---------------- */

/* 250 ms: el tiempo de dejar de teclear una palabra entera. Cada tecla sería
   una petición si no se agruparan. */
let temporizador = null;

document.querySelector('#buscar').addEventListener('input', () => {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    filtros.q = document.querySelector('#buscar').value.trim();
    void cargar();
  }, 250);
});

document.querySelector('#filtro-estado').addEventListener('change', (evento) => {
  filtros.estado = evento.target.value;
  void cargar();
});

document.querySelector('#filtro-categoria').addEventListener('change', (evento) => {
  filtros.categoryId = evento.target.value;
  void cargar();
});

document.querySelector('#recargar').addEventListener('click', () => void cargar());

/* ---------------- Arranque ---------------- */

lista.innerHTML = esqueleto(4);
await cargarOpciones();
await cargar();
