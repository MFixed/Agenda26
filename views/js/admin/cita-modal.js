/**
 * Modal de detalle de una cita, compartido por el panel, el listado y el
 * calendario. Muestra la ficha completa y ofrece las acciones que el estado
 * permite; si el servidor rechaza una, se muestra su mensaje.
 *
 * Los botones de acción cambian con el estado porque las transiciones
 * permitidas dependen de él: una cita completada ya no admite "confirmar", y
 * ofrecerlo solo genera rechazos.
 */
import {
  ESTADOS_CITA,
  esc,
  fecha,
  fechaHora,
  get,
  hoy,
  insignia,
  del,
  normalizarCita,
  post,
  put,
  textoError,
} from '../api.js';
import { abrirDialogo, avatar, dato, confirmar, preguntar, aviso } from '../ui.js';

/** Acciones disponibles por estado. `confirmar` pide doble clic antes. */
const ACCIONES = {
  PENDING: [
    { accion: 'coordinar', texto: 'Confirmar cita', clase: 'btn-primary', pideConfirmar: false },
    { accion: 'rechazar', texto: 'Rechazar', clase: 'btn-quiet', pideConfirmar: true },
    { accion: 'cancelar-admin', texto: 'Cancelar', clase: 'btn-quiet', pideConfirmar: true },
  ],
  COORDINATED: [
    { accion: 'checkin', texto: 'Registrar llegada', clase: 'btn-quiet', pideConfirmar: false },
    { accion: 'completar', texto: 'Marcar completada', clase: 'btn-primary', pideConfirmar: true },
    { accion: 'no-show', texto: 'No asistió', clase: 'btn-quiet', pideConfirmar: true },
    { accion: 'cancelar-admin', texto: 'Cancelar', clase: 'btn-quiet', pideConfirmar: true },
  ],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/**
 * Abre el detalle de una cita.
 * @param {number} id
 * @param {{alCambiar?: Function}} opciones - `alCambiar` refresca la pantalla.
 */
export async function abrirCita(id, { alCambiar } = {}) {
  let cita;
  try {
    ({ cita } = await get(`/api/appointments/${id}`));
    cita = normalizarCita(cita);
  } catch (error) {
    // Un 404 significa que alguien la borro en otra pestaña. Avisar es mejor
    // que abrir un modal vacío.
    aviso(textoError(error), 'error');
    return;
  }

  const dialogo = abrirDialogo('detalle-dialog');
  if (!dialogo) {
    return;
  }

  dialogo.innerHTML = plantilla(cita);

  dialogo.querySelector('[data-cerrar]')?.addEventListener('click', () => dialogo.close());

  dialogo.querySelector('[data-reprogramar]')?.addEventListener('click', async () => {
    await reprogramar(cita);
    await abrirCita(cita.id, { alCambiar });
    alCambiar?.();
  });

  dialogo.querySelector('[data-recordar]')?.addEventListener('click', async (evento) => {
    const boton = evento.currentTarget;
    boton.disabled = true;
    try {
      await post(`/api/appointments/${cita.id}/reminders`, {});
      aviso('Recordatorio enviado.', 'ok');
    } catch (error) {
      aviso(textoError(error), 'error');
    } finally {
      boton.disabled = false;
    }
  });

  for (const boton of dialogo.querySelectorAll('[data-accion]')) {
    boton.addEventListener('click', async () => {
      const hecha = await ejecutarAccion(
        cita,
        boton.dataset.accion,
        boton.dataset.texto,
        boton.dataset.aviso
      );
      if (hecha) {
        await abrirCita(cita.id, { alCambiar });
        alCambiar?.();
      }
    });
  }

  dialogo.querySelector('[data-borrar]')?.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Eliminar cita',
      texto: `Se eliminará la cita de "${cita.task?.title || 'sin título'}". El horario queda libre.`,
      aviso: 'También se borra su historial. Esta acción no se puede deshacer.',
      textoBoton: 'Eliminar',
    });
    if (!ok) {
      return;
    }
    try {
      /*
       * Se usa `del()` de api.js y NO `fetch` a pelo.
       *
       * El `fetch` directo no llevaba cabecera `Authorization`, asi que el
       * middleware devolvia 401, `fetch` no lanza en un 4xx y el toast de
       * "Cita eliminada" salia igual: el admin veia un exito que no habia
       * ocurrido y la cita seguia occupying el horario.
       *
       * `del()` ademas lanza si la respuesta no es 2xx, con lo que aqui ya
       * se cae en el `catch` de verdad.
       */
      await del(`/api/appointments/${cita.id}`);
      dialogo.close();
      aviso('Cita eliminada.', 'ok');
      alCambiar?.();
    } catch (error) {
      aviso(textoError(error), 'error');
    }
  });

  dialogo.querySelector('[data-nota]')?.addEventListener('click', async () => {
    const campo = dialogo.querySelector('#detalle-nota');
    const boton = dialogo.querySelector('[data-nota]');
    boton.disabled = true;
    try {
      await put(`/api/appointments/${cita.id}`, { note: campo.value.trim() });
      aviso('Anotación guardada.', 'ok');
      await abrirCita(cita.id, { alCambiar });
      alCambiar?.();
    } catch (error) {
      aviso(textoError(error), 'error');
    } finally {
      boton.disabled = false;
    }
  });
}

/**
 * Motivo que pide cada accion y con que campo lo espera el servidor.
 *
 * Cancelar, rechazar y marcar una ausencia NO admiten un cuerpo vacio: el
 * backend responde 400 "Indica el motivo" (`appointment.service.js`). Sin esto,
 * cuatro de las siete transiciones fallaban siempre y el admin no veia por que.
 *
 * `no-show` usa `noShowReason` y el resto `cancelReason`, que es como lo mapea
 * `actionRules`.
 */
const MOTIVOS = {
  rechazar: {
    campo: 'cancelReason',
    etiqueta: 'Motivo del rechazo',
    placeholder: 'Por ejemplo: el cliente pidió otra fecha.',
  },
  'cancelar-admin': {
    campo: 'cancelReason',
    etiqueta: 'Motivo de la cancelación',
    placeholder: 'Por ejemplo: el profesional no está disponible.',
  },
  'no-show': {
    campo: 'noShowReason',
    etiqueta: 'Qué ocurrió',
    placeholder: 'Por ejemplo: el cliente no avisó y nocompareció.',
  },
};

/** Ejecuta una transición de estado, pidiendo confirmación y motivo si hace falta. */
async function ejecutarAccion(cita, accion, texto, textoAviso) {
  if (textoAviso) {
    const ok = await confirmar({
      titulo: texto,
      texto: `Cita de "${cita.task?.title || 'sin título'}" (${fecha(cita.availability?.date)}).`,
      aviso: textoAviso,
      textoBoton: texto,
    });
    if (!ok) {
      return false;
    }
  }

  /*
   * El motivo se pide DESPUES de confirmar y no dentro del confirmacion: `confirmar`
   * se cierra al aceptar, asi que un formulario dentro de ese dialogo se
   * cerraria antes de poder rellenarse.
   */
  const cuerpo = {};
  const motivo = MOTIVOS[accion];

  if (motivo) {
    const escrito = await preguntar({
      titulo: texto,
      texto: `Cita de "${cita.task?.title || 'sin título'}" (${fecha(cita.availability?.date)}).`,
      placeholder: motivo.placeholder,
      textoBoton: texto,
    });

    if (!escrito) {
      return false;
    }

    cuerpo[motivo.campo] = escrito;
  }

  try {
    await post(`/api/appointments/${cita.id}/${accion}`, cuerpo);
    aviso('Cita actualizada.', 'ok');
    return true;
  } catch (error) {
    aviso(textoError(error), 'error');
    return false;
  }
}

/* ---------------- Plantilla ---------------- */

function plantilla(cita) {
  const acciones = ACCIONES[cita.status] || [];
  const puedeMover = ['PENDING', 'COORDINATED'].includes(cita.status);
  const tieneCliente = Boolean(cita.client?.nombre);

  return `
    <div class="modal-body">
      <div class="modal-head">
        <div>
          <p class="eyebrow">Cita #${cita.id}</p>
          <h2 id="detalle-title">${esc(cita.task?.title || 'Cita')}</h2>
          <div class="row-tags">${insignia(cita.status, ESTADOS_CITA)}</div>
        </div>
        <button class="icon-btn" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      ${
        tieneCliente
          ? `<div class="client-row">
              ${avatar(cita.client.nombre, true)}
              <div class="client-row-main">
                <span class="client-row-name">${esc(cita.client.nombre)}</span>
                <span class="client-row-meta">${esc(cita.client.email || '')}</span>
                <span class="client-row-meta">${esc(cita.client.telefono || 'Sin teléfono')}</span>
              </div>
            </div>`
          : '<p class="muted">Esta cita no tiene cliente asignado.</p>'
      }

      <div class="detail-grid">
        ${dato('Categoría', cita.task?.category?.name)}
        ${dato('Fecha', fecha(cita.availability?.date))}
        ${dato('Horario', horaDe(cita.availability))}
        ${dato('Profesional', cita.staff?.nombre)}
        ${dato('Estado del hueco', ESTADOS_HUECO_TXT[cita.availability?.status] || cita.availability?.status)}
        ${dato('Creada', fechaHora(cita.createdAt))}
        ${dato('Última modificación', fechaHora(cita.updatedAt))}
        ${cita.availability?.note ? dato('Nota del horario', cita.availability.note, true) : ''}
      </div>

      <label class="field">
        <span>Anotación del cliente</span>
        <textarea id="detalle-nota" rows="3" maxlength="1000" placeholder="Sin anotación">${esc(cita.note || '')}</textarea>
      </label>
      <div>
        <button class="btn btn-quiet btn-sm" data-nota type="button">Guardar anotación</button>
      </div>

      ${historialDe(cita)}

      <div class="modal-foot">
        ${
          puedeMover
            ? '<button class="btn btn-quiet btn-sm" data-reprogramar type="button">Cambiar horario</button>'
            : ''
        }
        ${
          cita.status === 'COORDINATED' && tieneCliente
            ? '<button class="btn btn-quiet btn-sm" data-recordar type="button">Enviar recordatorio</button>'
            : ''
        }
        <span class="spacer" style="flex:1 1 auto"></span>
        ${acciones
          .map(
            (accion) =>
              `<button class="btn ${accion.clase} btn-sm" data-accion="${accion.accion}" type="button"
                 data-texto="${esc(accion.texto)}"
                 ${accion.pideConfirmar ? `data-aviso="${esc(AVISOS[accion.accion])}"` : ''}>${esc(accion.texto)}</button>`
          )
          .join('')}
        <button class="btn btn-danger btn-sm" data-borrar type="button">Eliminar</button>
      </div>
    </div>`;
}

const ESTADOS_HUECO_TXT = {
  AVAILABLE: 'Libre',
  HELD: 'En espera',
  RESERVED: 'Reservado',
  BLOCKED: 'Bloqueado',
};

/* El motivo de cada acción se escribe aquí y no dentro del botón: es texto
   largo y meterlo en un atributo lo haría ilegible en el HTML. */
const AVISOS = {
  rechazar: 'El cliente será avisado de que no se le puede coordinar.',
  'cancelar-admin': 'El horario vuelve a quedar libre y el cliente será avisado.',
  completar: 'La cita y su tarea quedarán como completadas.',
  'no-show': 'Se registrará que el cliente no asistió. No se puede deshacer.',
};

function horaDe(hueco) {
  if (!hueco?.startTime) {
    return '';
  }
  return `${hueco.startTime} – ${hueco.endTime || ''}`.trim();
}

function historialDe(cita) {
  if (!Array.isArray(cita.historial) || cita.historial.length === 0) {
    return '';
  }
  const lineas = cita.historial
    .map(
      (evento) => `
      <li>
        <div class="row-tags">
          <strong>${esc(ETIQUETA_EVENTO[evento.toStatus] || evento.toStatus)}</strong>
          ${evento.fromStatus ? `<span class="muted small">desde ${esc(ETIQUETA_EVENTO[evento.fromStatus] || evento.fromStatus)}</span>` : ''}
          <time class="muted small">${esc(fechaHora(evento.createdAt))}</time>
          ${evento.actor ? `<span class="chip">${esc(evento.actor.nombre)}</span>` : ''}
        </div>
        ${evento.note ? `<p class="muted small" style="margin:.25rem 0 0">${esc(evento.note)}</p>` : ''}
      </li>`
    )
    .join('');

  return `<section><h3>Historial</h3><ul class="timeline">${lineas}</ul></section>`;
}

const ETIQUETA_EVENTO = {
  PENDING: 'Pendiente',
  COORDINATED: 'Coordinada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rechazada',
  NO_SHOW: 'No asistió',
  CHECKED_IN: 'Registró llegada',
};

/* ---------------- Reprogramar ---------------- */

/**
 * Mueve la cita a otro hueco libre. Se ofrece una lista en vez de un prompt
 * con números: un prompt no se puede desplazar y con veinte huecos obliga a
 * contar en la pantalla.
 */
async function reprogramar(cita) {
  let huecos = [];
  try {
    ({ items: huecos } = await get(`/api/availability?estado=AVAILABLE&desde=${hoy()}&limit=100`));
  } catch (error) {
    aviso(textoError(error), 'error');
    return;
  }

  const libres = (huecos || []).filter((hueco) => hueco.id !== cita.availabilityId);
  if (libres.length === 0) {
    aviso('No hay horarios libres a partir de hoy.', 'error');
    return;
  }

  // Se agrupan por dia para que la lista sea un agenda y no 40 lineas sueltas.
  const porDia = new Map();
  for (const hueco of libres) {
    if (!porDia.has(hueco.date)) {
      porDia.set(hueco.date, []);
    }
    porDia.get(hueco.date).push(hueco);
  }

  const dialogo = abrirDialogo('reprogramar-dialog');
  if (!dialogo) {
    return;
  }

  dialogo.innerHTML = `
    <div class="modal-body">
      <div class="modal-head">
        <div>
          <p class="eyebrow">Cambio de horario</p>
          <h2 id="reprogramar-title">Mover la cita</h2>
        </div>
        <button class="icon-btn" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>
      ${[...porDia.entries()]
        .map(
          ([dia, delDia]) => `
          <div class="dia-group">
            <div class="dia-group-head"><strong>${esc(fecha(dia))}</strong></div>
            <div class="slot-grid">
              ${delDia
                .map(
                  (hueco) => `
                  <button class="slot-btn" type="button" data-hueco="${hueco.id}">
                    <strong>${esc(hueco.startTime)}–${esc(hueco.endTime)}</strong>
                    ${hueco.note ? `<small>${esc(hueco.note)}</small>` : ''}
                  </button>`
                )
                .join('')}
            </div>
          </div>`
        )
        .join('')}
    </div>`;

  dialogo.querySelector('[data-cerrar]')?.addEventListener('click', () => dialogo.close());

  for (const boton of dialogo.querySelectorAll('[data-hueco]')) {
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        await put(`/api/appointments/${cita.id}`, { availabilityId: Number(boton.dataset.hueco) });
        dialogo.close();
        aviso('Cita reprogramada.', 'ok');
      } catch (error) {
        boton.disabled = false;
        aviso(textoError(error), 'error');
      }
    });
  }
}
