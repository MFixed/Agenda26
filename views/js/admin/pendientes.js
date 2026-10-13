/**
 * Cola de citas pendientes. Es la misma vista en el panel y en la página de
 * citas, así que vive aquí y las dos la pintan llamando a `cargarPendientes`.
 *
 * No lleva lógica de negocio: sólo pide la cola al servidor y la dibuja. Las
 * acciones (confirmar, rechazar…) están en cita-modal.js, que se abre al
 * pulsar una fila.
 */
import { ESTADOS_CITA, esc, fecha, get, insignia } from '../api.js';
import { conectarFilas, esqueleto, vacio } from '../ui.js';
import { abrirCita } from './cita-modal.js';

/**
 * @param {object} opciones
 * @param {string|HTMLElement} opciones.contenedor - donde se pinta.
 * @param {string} [opciones.contador] - selector donde va el total.
 * @param {number} [opciones.limite] - cuántas mostrar (por defecto 6).
 * @param {Function} [opciones.alCambiar] - callback a ejecutar al resolver una.
 */
export async function cargarPendientes({ contenedor, contador = null, limite = 6, alCambiar = null } = {}) {
  const destino = typeof contenedor === 'string' ? document.querySelector(contenedor) : contenedor;
  if (!destino) {
    return;
  }

  destino.innerHTML = esqueleto(Math.min(limite, 3));

  let pendientes;
  try {
    pendientes = await get(`/api/appointments?estado=PENDING&limit=${limite}`);
  } catch (error) {
    // La cola es una comodidad: si falla, el resto de la página sigue viva.
    destino.innerHTML = vacio('No se pudo cargar la cola', 'Inténtalo de nuevo en un momento.');
    return;
  }

  if (contador) {
    const destinoContador = document.querySelector(contador);
    if (destinoContador) {
      try {
        // El total sale de /resumen: aquí solo llega la página pedida.
        const { resumen } = await get('/api/appointments/resumen');
        destinoContador.textContent = resumen?.pendientes ?? 0;
      } catch {
        // Si /resumen falla, se deja el contador como estaba: es preferible un
        // "—" a un número inventado.
      }
    }
  }

  const items = pendientes?.items || [];
  destino.innerHTML =
    items.length === 0
      ? vacio('Nada pendiente', 'No hay citas esperando respuesta.')
      : items.map(filaPendiente).join('');

  conectarFilas(destino, (id) => void abrirCita(id, { alCambiar }));
}

/**
 * Una cita pendiente. El cliente se muestra porque es quien hay que decidir.
 * El borde en color de aviso marca la urgencia sin necesidad de otro texto.
 */
function filaPendiente(cita) {
  return `
    <article class="row-card" data-id="${cita.id}" style="--accent:var(--warning)">
      <div class="row-main">
        <span class="row-title">${esc(cita.task?.title || 'Cita')}</span>
        <span class="row-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || '')}–${esc(cita.availability?.endTime || '')}
          ${cita.task?.category?.name ? ` · ${esc(cita.task.category.name)}` : ''}
        </span>
        ${cita.note ? `<p class="row-note">${esc(cita.note)}</p>` : ''}
      </div>
      ${cita.client?.nombre ? `<span class="chip">${esc(cita.client.nombre)}</span>` : ''}
      ${insignia(cita.status, ESTADOS_CITA)}
    </article>`;
}
