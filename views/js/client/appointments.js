/**
 * Historial de citas del cliente: filtro por estado, detalle y cancelación
 * mientras siga pendiente.
 *
 * La cancelación desde aquí, en vez de un teléfono a la administración, es lo que
 * devuelve el hueco al calendario sin intervención: una cita que se cancela de
 * palabra se queda huérfana hasta que alguien la limpia a mano.
 */
import {
  ESTADOS_CITA,
  esc,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  insignia,
  normalizarCita,
  normalizarCitas,
  post,
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
  montarApp,
  preguntar,
  vacio,
} from '../ui.js';

const sesion = await exigirSesion('CLIENT');
if (!sesion) {
  throw new Error('sin sesion');
}

montarApp(sesion, 'cliente');
conectarCierres();

const lista = document.querySelector('#lista-citas');

/* ---------------- Listado ---------------- */

async function cargar() {
  const estado = document.querySelector('#filtro-estado').value;
  lista.innerHTML = esqueleto(4);

  let citas;
  try {
    ({ items: citas } = await get(`/api/appointments?limit=200${estado ? `&estado=${estado}` : ''}`));
  } catch (error) {
    lista.innerHTML = '';
    lista.insertAdjacentHTML('beforeend', vacio('No se pudieron cargar tus citas', textoError(error)));
    return;
  }

  citas = normalizarCitas(citas) || [];
  pintarResumen(citas);

  /* Se ordena por fecha: el listado es un historial y lo que importa es el
     orden en el que ocurrieron las cosas. */
  citas.sort((a, b) => (b.availability?.date || '').localeCompare(a.availability?.date || ''));

  lista.innerHTML =
    citas.length === 0
      ? vacio('Sin citas', 'Cuando reserves una aparecerá aquí con su estado.')
      : citas.map(filaCita).join('');

  conectarFilas(lista, (id) => void abrirDetalle(id));
}

function pintarResumen(citas) {
  const contar = (estado) => citas.filter((cita) => cita.status === estado).length;
  document.querySelector('#stat-total').textContent = citas.length;
  document.querySelector('#stat-pendientes').textContent = contar('PENDING');
  document.querySelector('#stat-coordinadas').textContent = contar('COORDINATED');
  document.querySelector('#stat-completadas').textContent = contar('COMPLETED');
}

function filaCita(cita) {
  const acento =
    { PENDING: 'var(--warning)', COORDINATED: 'var(--success)' }[cita.status] || 'var(--border-strong)';

  return `
    <article class="row-card" data-id="${cita.id}" style="--accent:${acento}">
      <div class="row-main">
        <span class="row-title">${esc(cita.task?.title || 'Cita')}</span>
        <span class="row-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || '')}–${esc(cita.availability?.endTime || '')}
          ${cita.task?.category?.name ? ` · ${esc(cita.task.category.name)}` : ''}
          ${cita.staff?.nombre ? ` · ${esc(cita.staff.nombre)}` : ''}
        </span>
        ${cita.note ? `<p class="row-note">${esc(cita.note)}</p>` : ''}
      </div>
      ${insignia(cita.status, ESTADOS_CITA)}
    </article>`;
}

/* ---------------- Detalle ---------------- */

async function abrirDetalle(id) {
  let cita;
  try {
    ({ cita } = await get(`/api/appointments/${id}`));
    cita = normalizarCita(cita);
  } catch (error) {
    aviso(textoError(error), 'error');
    return;
  }

  const dialogo = abrirDialogo('detalle-dialog');
  if (!dialogo) {
    return;
  }

  const historial = (cita.historial || [])
    .map(
      (evento) => `
      <li>
        <div class="row-tags">
          <strong>${esc(ETIQUETA[evento.toStatus] || evento.toStatus)}</strong>
          <time class="muted small">${esc(fechaHora(evento.createdAt))}</time>
        </div>
        ${evento.note ? `<p class="muted small" style="margin:.25rem 0 0">${esc(evento.note)}</p>` : ''}
      </li>`
    )
    .join('');

  dialogo.innerHTML = `
    <div class="modal-body">
      <div class="modal-head">
        <div>
          <p class="eyebrow">Cita #${cita.id}</p>
          <h2 id="detalle-title">${esc(cita.task?.title || 'Cita')}</h2>
          <div class="row-tags">${insignia(cita.status, ESTADOS_CITA)}</div>
        </div>
        <button class="icon-btn" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="detail-grid">
        ${dato('Categoría', cita.task?.category?.name)}
        ${dato('Fecha', fecha(cita.availability?.date))}
        ${dato('Horario', `${cita.availability?.startTime || ''} – ${cita.availability?.endTime || ''}`)}
        ${dato('Profesional', cita.staff?.nombre)}
        ${dato('Solicitada', fechaHora(cita.createdAt))}
        ${dato('Última actualización', fechaHora(cita.updatedAt))}
        ${dato('Tu anotación', cita.note, true)}
      </div>

      ${historial ? `<section><h3>Historial</h3><ul class="timeline">${historial}</ul></section>` : ''}

      <div class="modal-foot">
        ${
          cita.status === 'PENDING'
            ? '<button class="btn btn-danger btn-sm" data-cancelar type="button">Cancelar mi cita</button>'
            : ''
        }
      </div>
    </div>`;

  dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
  dialogo.querySelector('[data-cancelar]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Cancelar la cita',
      texto: `Vas a cancelar "${cita.task?.title || 'tu cita'}" del ${fecha(cita.availability?.date)}.`,
      aviso: 'El horario vuelve a quedar libre para otras personas.',
      textoBoton: 'Cancelar cita',
    });
    if (!ok) {
      return;
    }

    /*
     * El motivo se pide aparte, y es obligatorio: el backend rechaza con 400
     * "Indica el motivo" una cancelacion sin `cancelReason`
     * (`appointment.service.js`). Mandar el cuerpo vacio hacia que la
     * cancelacion del cliente fallase siempre.
     */
    const motivo = await preguntar({
      titulo: 'Cancelar la cita',
      texto: '¿Por qué cancelas? Se lo llega a la administración.',
      placeholder: 'Por ejemplo: no puedo asistir ese día.',
      textoBoton: 'Cancelar cita',
    });

    if (!motivo) {
      return;
    }

    try {
      await post(`/api/appointments/${cita.id}/cancelar`, { cancelReason: motivo });
      dialogo.close();
      aviso('Cita cancelada.', 'ok');
      await cargar();
    } catch (error) {
      aviso(textoError(error), 'error');
    }
  });

  // `abrirDialogo` ya lo abrio con showModal(): llamarlo otra vez lanza
  // InvalidStateError y, al propagarse, deja sin conectar los listeners de arriba.
}

const ETIQUETA = {
  PENDING: 'Pendiente',
  COORDINATED: 'Coordinada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rechazada',
  NO_SHOW: 'No asistí',
  CHECKED_IN: 'Registró llegada',
};

/* ---------------- Filtros ---------------- */

document.querySelector('#filtro-estado').addEventListener('change', () => void cargar());
document.querySelector('#recargar').addEventListener('click', () => void cargar());

await cargar();
