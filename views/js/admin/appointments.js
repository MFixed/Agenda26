/**
 * Listado de citas del administrador: filtros por estado y cliente, búsqueda
 * por texto, paginación y resolución de cada cita.
 *
 * El alta de citas no está aquí: vive en el panel principal, que es el único
 * sitio desde el que se crean, y es donde también se puede habilitar el
 * horario que la necesita.
 */
import { ESTADOS_CITA, esc, exigirSesion, fecha, get, insignia, normalizarCita, textoError } from '../api.js';
import { botonRecordatorio, conectarCierres, conectarFilas, montarApp, vacio } from '../ui.js';
import { abrirCita } from './cita-modal.js';
import { cargarPendientes } from './pendientes.js';

const sesion = await exigirSesion(['ADMIN', 'STAFF']);
if (!sesion) {
  throw new Error('sin sesion');
}

montarApp(sesion, 'admin');
conectarCierres();

const LIMIT = 20;
const filtros = { estado: '', cliente: '', q: '', pagina: 1 };
let totalPaginas = 1;

const lista = document.querySelector('#lista-citas');

/* ---------------- Carga ---------------- */

async function cargar() {
  const parametros = new URLSearchParams({
    estado: filtros.estado,
    q: filtros.q,
    limit: String(LIMIT),
    offset: String((filtros.pagina - 1) * LIMIT),
  });
  if (filtros.cliente) {
    parametros.set('clientId', filtros.cliente);
  }

  let citas;
  try {
    [citas] = await Promise.all([get(`/api/appointments?${parametros}`), pintarResumen()]);
  } catch (error) {
    lista.innerHTML = '';
    // El listado es la parte esencial de la página: si falla se dice, pero sin
    // borrar todo lo que hubiera, que puede que aún no haya nada pintado.
    lista.insertAdjacentHTML('beforeend', vacio('No se pudieron cargar las citas', textoError(error)));
    return;
  }

  totalPaginas = Math.max(1, Math.ceil((citas?.total || 0) / LIMIT));
  pintar(citas?.items || [], citas?.total || 0);
  pintarPaginacion(citas?.total || 0);

  /* La cola de pendientes es la misma vista del panel principal, sólo que aquí
     no se limita a 6: se ven todas las que esperan respuesta. */
  await cargarPendientes({
    contenedor: '#lista-pendientes',
    contador: '#pendientes-total',
    limite: 50,
    alCambiar: cargar,
  });
}

function pintar(citas, total = citas.length) {
  // El contador de arriba dice cuantas hay EN TOTAL, no las de esta pagina: con
  // `citas.length` se quedaba clavado en el tamano de la pagina (20) en cuanto
  // habia mas, y decia "20 citas" teniendo 400.
  document.querySelector('#listado-total').textContent = total;

  lista.innerHTML =
    citas.length === 0
      ? vacio('Sin citas', 'Prueba con otro filtro, o crea una nueva desde el panel principal.')
      : citas.map((cita) => filaConCliente(normalizarCita(cita))).join('');

  conectarFilas(lista, (id) => void abrirCita(id, { alCambiar: cargar }));
}

function filaConCliente(cita) {
  const acento =
    { PENDING: 'var(--warning)', COORDINATED: 'var(--success)' }[cita.status] || 'var(--border-strong)';

  return `
    <article class="row-card" data-id="${cita.id}" style="--accent:${acento}">
      <div class="row-main">
        <span class="row-title">${esc(cita.task?.title || 'Cita')}</span>
        <span class="row-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || '')}–${esc(cita.availability?.endTime || '')}
          ${cita.task?.category?.name ? ` · ${esc(cita.task.category.name)}` : ''}
        </span>
        ${cita.note ? `<p class="row-note">${esc(cita.note)}</p>` : ''}
      </div>
      <div class="row-tags">
        ${cita.client?.nombre ? `<span class="chip">${esc(cita.client.nombre)}</span>` : ''}
        ${cita.staff?.nombre ? `<span class="chip">${esc(cita.staff.nombre)}</span>` : ''}
      </div>
      ${botonRecordatorio(cita)}
      ${insignia(cita.status, ESTADOS_CITA)}
    </article>`;
}

/* ---------------- Resumen ---------------- */

/* El resumen va aparte y a su aire: si /resumen falla, el listado sigue
   mostrando citas, que es lo que el usuario vino a ver. */
async function pintarResumen() {
  try {
    const { resumen } = await get('/api/appointments/resumen');
    const cifras = resumen || {};
    document.querySelector('#stat-pendientes').textContent = cifras.pendientes ?? '—';
    document.querySelector('#stat-coordinadas').textContent = cifras.coordinadas ?? '—';
    document.querySelector('#stat-completadas').textContent = cifras.completadas ?? '—';
    document.querySelector('#stat-cerradas').textContent =
      (cifras.canceladas || 0) + (cifras.rechazadas || 0);
  } catch {
    // Las tarjetas se quedan en "—": un número aproximado sería peor que nada.
  }
}

function pintarPaginacion(total) {
  const paginador = document.querySelector('#pager');
  paginador.hidden = total <= LIMIT;
  document.querySelector('#pager-info').textContent =
    `Página ${filtros.pagina} de ${totalPaginas} · ${total} cita${total === 1 ? '' : 's'}`;
  document.querySelector('#pager-anterior').disabled = filtros.pagina <= 1;
  document.querySelector('#pager-siguiente').disabled = filtros.pagina >= totalPaginas;
}

/* ---------------- Filtros ---------------- */

/* 250 ms es el punto en el que el usuario deja de teclear una palabra entera.
   Cada tecla es una petición: sin este retardo, buscar "instalación" dispara
   doce consultas. */
let temporizador = null;

function alEscribir() {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    filtros.q = document.querySelector('#buscar').value.trim();
    filtros.pagina = 1;
    void cargar();
  }, 250);
}

document.querySelector('#buscar').addEventListener('input', alEscribir);

document.querySelector('#filtro-estado').addEventListener('change', (evento) => {
  filtros.estado = evento.target.value;
  filtros.pagina = 1;
  void cargar();
});

document.querySelector('#filtro-cliente').addEventListener('change', (evento) => {
  filtros.cliente = evento.target.value;
  filtros.pagina = 1;
  void cargar();
});

document.querySelector('#recargar').addEventListener('click', () => void cargar());
document.querySelector('#pager-anterior').addEventListener('click', () => {
  filtros.pagina = Math.max(1, filtros.pagina - 1);
  void cargar();
});
document.querySelector('#pager-siguiente').addEventListener('click', () => {
  filtros.pagina = Math.min(totalPaginas, filtros.pagina + 1);
  void cargar();
});

/* ---------------- Filtro por cliente ---------------- */

/* El filtro es una comodidad: si la lista de clientes no llega, el listado
   sigue funcionando con todos los clientes. */
async function cargarFiltroClientes() {
  try {
    const { items } = await get('/api/clients?limit=200');
    document.querySelector('#filtro-cliente').innerHTML =
      '<option value="">Todos los clientes</option>' +
      (items || [])
        .map((cliente) => `<option value="${cliente.id}">${esc(cliente.nombre)}</option>`)
        .join('');
  } catch {
    // Se deja la opción por defecto.
  }
}

await Promise.all([cargar(), cargarFiltroClientes()]);
