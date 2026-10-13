/**
 * Panel del cliente: sus citas, los horarios libres, la reserva y la lista de
 * espera.
 *
 * La hora se elige tocando un horario de la lista; el resto lo pone la
 * administración. Cuando no hay ningún hueco libre, en vez de un "vuelve más
 * tarde" se ofrece la lista de espera: quien acaba de ver rechazado una cita
 * no puede aprender de un mensaje de que no hay nada que hacer.
 */
import {
  ESTADOS_CITA,
  datosDe,
  esc,
  exigirSesion,
  fecha,
  get,
  hoy,
  insignia,
  normalizarCita,
  normalizarCitas,
  plural,
  post,
  textoError,
} from '../api.js';
import {
  abrirDialogo,
  aviso,
  conectarCierres,
  conectarFilas,
  confirmar,
  dato,
  esqueleto,
  filaCita,
  marcarErrores,
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

document.querySelector('#saludo').textContent = `Hola, ${(sesion.user.nombre || '').split(' ')[0]}`;

const listaCitas = document.querySelector('#lista-citas');
const listaHuecos = document.querySelector('#lista-huecos');
const dialogoPedir = document.querySelector('#pedir-dialog');
const formularioPedir = document.querySelector('#pedir-form');
const errorPedir = document.querySelector('#pedir-error');
const dialogoEspera = document.querySelector('#espera-dialog');
const formularioEspera = document.querySelector('#espera-form');
const errorEspera = document.querySelector('#espera-error');

let huecos = [];
let categorias = [];
let citas = [];

/* ---------------- Carga ---------------- */

/* Cada bloque va por su cuenta: si fallan las citas, los horarios libres siguen
   apareciendo y el cliente puede reservar. */
async function cargar() {
  await Promise.allSettled([cargarCitas(), cargarHuecos(), cargarCategorias()]);
}

async function cargarCitas() {
  try {
    const { items } = await get('/api/appointments?limit=100');
    citas = normalizarCitas(items) || [];
  } catch {
    listaCitas.innerHTML = vacio('No se pudieron cargar tus citas', 'Inténtalo de nuevo en un momento.');
    return;
  }

  const pendientes = citas.filter((cita) => cita.status === 'PENDING').length;
  const coordinadas = citas.filter((cita) => cita.status === 'COORDINATED').length;
  const futuras = citas
    .filter((cita) => ['PENDING', 'COORDINATED'].includes(cita.status))
    .sort((a, b) => (a.availability?.date || '').localeCompare(b.availability?.date || ''));

  document.querySelector('#stat-total').textContent = citas.length;
  document.querySelector('#stat-pendientes').textContent = pendientes;
  document.querySelector('#stat-coordinadas').textContent = coordinadas;

  /* La próxima cita cabe en una tarjeta estrecha: la fecha corta, no la larga. */
  document.querySelector('#stat-proxima').textContent = futuras[0]
    ? fecha(futuras[0].availability?.date)
    : '—';

  listaCitas.innerHTML =
    citas.length === 0
      ? vacio('Todavía no tienes citas', 'Reserva un horario libre en el panel de la derecha.')
      : citas
          .slice(0, 6)
          .map((cita) => filaCita(cita))
          .join('');

  conectarFilas(listaCitas, (id) => void abrirDetalle(id));
}

async function cargarHuecos() {
  try {
    const { items } = await get(`/api/availability?estado=AVAILABLE&desde=${hoy()}&limit=24`);
    huecos = items || [];
  } catch {
    // El 404 aquí significa que no hay endpoint de disponibilidad todavía: se
    // dice con texto y se ofrece la lista de espera, que sí puede funcionar.
    huecos = [];
    listaHuecos.innerHTML = '';
    document.querySelector('#huecos-total').textContent = '';
    mostrarEspera(true);
    return;
  }

  document.querySelector('#huecos-total').textContent =
    huecos.length === 0 ? 'sin huecos' : plural(huecos.length, 'hueco', 'huecos');

  listaHuecos.innerHTML =
    huecos.length === 0
      ? '<p class="muted">Ahora mismo no hay horarios publicados. Vuelve más adelante.</p>'
      : huecos.slice(0, 12).map(botonHueco).join('');

  mostrarEspera(huecos.length === 0);

  for (const boton of listaHuecos.querySelectorAll('[data-hueco]')) {
    boton.addEventListener('click', () => {
      const hueco = huecos.find((item) => item.id === Number(boton.dataset.hueco));
      if (hueco) {
        abrirPedir(hueco);
      }
    });
  }
}

async function cargarCategorias() {
  try {
    ({ items: categorias } = await get('/api/categories'));
    categorias = categorias || [];
  } catch {
    categorias = [];
  }

  const opciones =
    '<option value="">SERVICIOS (por defecto)</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join('');

  document.querySelector('#pedir-categoria').innerHTML = opciones;
  document.querySelector('#espera-categoria').innerHTML = opciones;
}

function botonHueco(hueco) {
  return `
    <button class="slot-btn" type="button" data-hueco="${hueco.id}">
      <strong>${esc(hueco.startTime)}–${esc(hueco.endTime)}</strong>
      <small>${esc(fecha(hueco.date))}${hueco.note ? ` · ${esc(hueco.note)}` : ''}</small>
    </button>`;
}

function mostrarEspera(visible) {
  document.querySelector('#zona-espera').hidden = !visible;
}

/* ---------------- Reservar horario ---------------- */

function abrirPedir(hueco) {
  formularioPedir.reset();
  errorPedir.hidden = true;
  marcarErrores(formularioPedir, null);

  document.querySelector('#pedir-availability').value = hueco.id;
  document.querySelector('#pedir-fecha').value = `${fecha(hueco.date)} · ${hueco.startTime}–${hueco.endTime}`;
  document.querySelector('#pedir-resumen').textContent =
    'Al enviar la solicitud el horario queda en espera hasta que la administración la confirme. Si la rechazan, se libera.';

  abrirDialogo('pedir-dialog');
  document.querySelector('#pedir-nota').focus();
}

formularioPedir.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorPedir.hidden = true;
  marcarErrores(formularioPedir, null);

  const datos = datosDe(formularioPedir);
  const boton = formularioPedir.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    await post('/api/appointments', {
      availabilityId: Number(datos.availabilityId),
      categoryId: datos.categoria ? Number(datos.categoria) : null,
      title: datos.servicio || null,
      note: datos.note || null,
    });
    dialogoPedir.close();
    aviso('Solicitud enviada. Te avisaremos cuando la confirmen.', 'ok');
    await cargar();
  } catch (error) {
    /* Si el hueco se acaba de ocupar entre que se listó y se reservó, el
       servidor lo dice y se recarga la lista para que el cliente vea que ya no
       está disponible, en vez de dejar el formulario con un hueco muerto. */
    marcarErrores(formularioPedir, error, { general: errorPedir });
    if (error.estado === 404 || error.estado === 409) {
      await cargarHuecos();
    }
  } finally {
    boton.disabled = false;
  }
});

/* ---------------- Lista de espera ---------------- */

document.querySelector('#apuntarse-espera').addEventListener('click', () => {
  formularioEspera.reset();
  errorEspera.hidden = true;
  marcarErrores(formularioEspera, null);
  abrirDialogo('espera-dialog');
});

formularioEspera.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorEspera.hidden = true;
  marcarErrores(formularioEspera, null);

  const datos = datosDe(formularioEspera);
  const cuerpo = {
    categoryId: datos.categoryId ? Number(datos.categoryId) : null,
    title: datos.servicio || null,
    note: datos.note || null,
  };
  if (datos.diaPreferido) {
    cuerpo.diaPreferido = Number(datos.diaPreferido);
  }

  const boton = formularioEspera.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    await post('/api/waitlist', cuerpo);
    dialogoEspera.close();
    aviso('Te hemos apuntado. Te avisamos cuando haya un hueco.', 'ok');
    document.querySelector('#apuntarse-espera').disabled = true;
    document.querySelector('#apuntarse-espera').textContent = 'Ya estás en la lista de espera';
  } catch (error) {
    marcarErrores(formularioEspera, error, { general: errorEspera });
  } finally {
    boton.disabled = false;
  }
});

/* ---------------- Detalle de cita ---------------- */

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
        ${dato('Solicitada', fecha(cita.createdAt))}
        ${dato('Tu anotación', cita.note, true)}
      </div>

      ${explicacion(cita)}

      <div class="modal-foot">
        ${
          cita.status === 'PENDING'
            ? '<button class="btn btn-danger btn-sm" data-cancelar type="button">Cancelar mi cita</button>'
            : ''
        }
        ${botonRecordatorio(cita)}
      </div>
    </div>`;

  dialogo.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());
  dialogo.querySelector('[data-cancelar]')?.addEventListener('click', () => cancelar(cita, dialogo));

  // `abrirDialogo` ya lo abrio con `showModal()`: llamarlo otra vez lanzaba
  // `InvalidStateError` y dejaba el boton de cancelar sin listener.
}

/** Una línea por estado: el cliente no tiene por qué saber qué implica cada
    uno, pero sí tiene que saber qué puede hacer ahora. */
function explicacion(cita) {
  const textos = {
    PENDING: 'La administración todavía no ha confirmado tu cita. Puedes cancelarla si ya no la necesitas.',
    COORDINATED: 'Tu cita está confirmada. Acude el día y a la hora indicados.',
    COMPLETED: 'Esta cita ya se realizó. Su historial se conserva aquí.',
    CANCELLED: 'Esta cita se canceló.',
    REJECTED: 'Esta cita no se pudo coordinar. Puedes reservar otro horario cuando haya uno libre.',
    NO_SHOW: 'Se registró que no fuiste a esta cita.',
  };
  const texto = textos[cita.status];
  return texto ? `<p class="note ${cita.status === 'REJECTED' ? 'note--warn' : ''}">${esc(texto)}</p>` : '';
}

function botonRecordatorio(cita) {
  if (cita.status !== 'COORDINATED') {
    return '';
  }

  let numero = String(sesion.user.telefono || '').replace(/\D/g, '');
  if (!numero) {
    return '';
  }
  if (!numero.startsWith('598')) {
    numero = `598${numero.replace(/^0+/, '')}`;
  }

  const texto = `¡Hola ${sesion.user.nombre}! 👋 Te recordamos tu cita de "${cita.task?.title || 'Cita'}" el ${fecha(cita.availability?.date)} · ${cita.availability?.startTime || ''}–${cita.availability?.endTime || ''}. ¡Te esperamos!`;

  return `<a class="btn btn-quiet btn-sm" href="https://wa.me/${numero}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">📣 Recordarme</a>`;
}

async function cancelar(cita, dialogo) {
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
   * El motivo es obligatorio: el backend responde 400 "Indica el motivo" a una
   * cancelacion sin `cancelReason`, asi que mandar el cuerpo vacio hacia que
   * cancelar desde el panel fallase siempre.
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
}

await cargar();
