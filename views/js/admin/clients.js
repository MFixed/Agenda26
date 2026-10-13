/**
 * Panel de clientes: alta, edición, ficha y baja. El correo y la contraseña se
 * gestionan desde la cuenta del usuario; aquí sólo se editan.
 */
import {
  datosDe,
  del,
  esc,
  exigirSesion,
  fecha,
  fechaHora,
  get,
  hoy,
  post,
  put,
  textoError,
} from '../api.js';
import {
  abrirDialogo,
  avatar,
  aviso,
  conectarCierres,
  confirmar,
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

const lista = document.querySelector('#lista-clientes');
const dialogoCliente = document.querySelector('#cliente-dialog');
const formularioCliente = document.querySelector('#cliente-form');
const errorCliente = document.querySelector('#cliente-error');

let clientes = [];

/* ---------------- Listado ---------------- */

async function cargar() {
  const busqueda = document.querySelector('#buscar').value.trim();
  lista.innerHTML = esqueleto(4);

  try {
    const datos = await get(`/api/clients?limit=200${busqueda ? `&q=${encodeURIComponent(busqueda)}` : ''}`);
    clientes = datos?.items || [];

    lista.innerHTML =
      clientes.length === 0
        ? vacio('Sin clientes', 'Cambia la búsqueda o da de alta uno.')
        : clientes.map(filaCliente).join('');

    pintarResumen(clientes);
  } catch (error) {
    lista.innerHTML = '';
    lista.insertAdjacentHTML('beforeend', vacio('No se pudieron cargar los clientes', textoError(error)));
  }

  /* Un solo manejador en la lista, no uno por fila: la lista se repinta en cada
     búsqueda y treinta escuchadores nuevos en cada tecla no es una opción. */
  lista.addEventListener(
    'click',
    async (evento) => {
      const boton = evento.target.closest('button[data-accion]');
      if (!boton) {
        return;
      }
      const id = Number(boton.closest('[data-id]').dataset.id);
      if (boton.dataset.accion === 'editar') {
        await editar(id);
      } else {
        const cliente = clientes.find((item) => item.id === id);
        if (cliente) {
          await borrar(cliente);
        }
      }
    },
    true
  );

  for (const fila of lista.querySelectorAll('[data-id]')) {
    fila.classList.add('client-row--clickable');
    fila.setAttribute('tabindex', '0');
    fila.setAttribute('role', 'button');
    const abrir = () => void abrirDetalle(Number(fila.dataset.id));
    fila.addEventListener('click', (evento) => {
      if (evento.target.closest('button')) {
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

function filaCliente(cliente) {
  const meta = [cliente.email, cliente.documento && `Doc. ${cliente.documento}`].filter(Boolean).join(' · ');

  return `
    <article class="client-row${cliente.activo ? '' : ' client-row--off'}" data-id="${cliente.id}">
      ${avatar(cliente.nombre)}
      <div class="client-row-main">
        <span class="client-row-name">${esc(cliente.nombre)}</span>
        <span class="client-row-meta">${esc(meta)}</span>
      </div>
      <div class="client-row-actions">
        ${cliente.citas ? `<span class="chip">${cliente.citas} cita${cliente.citas === 1 ? '' : 's'}</span>` : ''}
        <span class="badge ${cliente.activo ? 'badge-active' : 'badge-inactive'}">${cliente.activo ? 'activo' : 'inactivo'}</span>
        <button class="icon-btn icon-btn-sm" type="button" data-accion="editar" aria-label="Editar cliente">✎</button>
      </div>
    </article>`;
}

function pintarResumen(listaClientes) {
  const conCitas = listaClientes.filter((cliente) => (cliente.citas || 0) > 0).length;
  const inactivos = listaClientes.filter((cliente) => !cliente.activo).length;
  const mes = hoy().slice(0, 7);
  const esteMes = listaClientes.filter((cliente) => (cliente.createdAt || '').slice(0, 7) === mes).length;

  document.querySelector('#stat-total').textContent = listaClientes.length;
  document.querySelector('#stat-con-citas').textContent = conCitas;
  document.querySelector('#stat-inactivos').textContent = inactivos;
  document.querySelector('#stat-mes').textContent = esteMes;
}

/* ---------------- Ficha ---------------- */

async function abrirDetalle(id) {
  let cliente;
  try {
    ({ cliente } = await get(`/api/clients/${id}`));
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
        <div class="client-row" style="border:0;padding:0;background:transparent;flex:1;min-width:0">
          ${avatar(cliente.nombre, true)}
          <div class="client-row-main">
            <span class="client-row-name" style="font-size:1.05rem">${esc(cliente.nombre)}</span>
            <span class="client-row-meta">${esc(cliente.email || '')}</span>
          </div>
        </div>
        <button class="icon-btn" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="detail-grid">
        ${dato('Documento', cliente.documento)}
        ${dato('Nacimiento', cliente.fechaNacimiento ? `${fecha(cliente.fechaNacimiento)}${cliente.edad ? ` · ${cliente.edad} años` : ''}` : '')}
        ${dato('Teléfono', cliente.telefono)}
        ${dato('Cuenta', cliente.activo ? 'Activa' : 'Inactiva')}
        ${dato('Citas', cliente.citas != null ? String(cliente.citas) : '')}
        ${dato('Tareas', cliente.tareas != null ? String(cliente.tareas) : '')}
        ${dato('Último acceso', fechaHora(cliente.ultimoAcceso))}
        ${dato('Alta', fechaHora(cliente.createdAt))}
        ${cliente.direccion ? dato('Dirección', cliente.direccion, true) : ''}
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
    abrirEditor(cliente);
  });
  dialogo.querySelector('[data-borrar]').addEventListener('click', async () => {
    dialogo.close();
    await borrar(cliente);
  });

  // `abrirDialogo` lo abrio ya con `showModal()`: llamarlo otra vez lanzaba
  // `InvalidStateError` y dejaba sin conectar los botones de arriba.
}

/* ---------------- Alta y edición ---------------- */

async function editar(id) {
  try {
    const { cliente } = await get(`/api/clients/${id}`);
    abrirEditor(cliente);
  } catch (error) {
    aviso(textoError(error), 'error');
  }
}

function abrirEditor(cliente) {
  formularioCliente.reset();
  errorCliente.hidden = true;
  marcarErrores(formularioCliente, null);

  const id = cliente ? cliente.id : '';
  document.querySelector('#cliente-id').value = id;
  document.querySelector('#cliente-dialog-title').textContent = cliente ? 'Editar cliente' : 'Nuevo cliente';
  document.querySelector('#cliente-nombre').value = cliente?.nombre || '';
  document.querySelector('#cliente-documento').value = cliente?.documento || '';
  document.querySelector('#cliente-nacimiento').value = cliente?.fechaNacimiento || '';
  document.querySelector('#cliente-email').value = cliente?.email || '';
  document.querySelector('#cliente-telefono').value = cliente?.telefono || '';
  document.querySelector('#cliente-direccion').value = cliente?.direccion || '';
  document.querySelector('#cliente-password').value = '';
  document.querySelector('#cliente-activo').checked = cliente ? cliente.activo !== false : true;

  /* El texto de la contraseña cambia según el caso: en alta es obligatoria o
     temporal; en edición, vacía significa "no la toques". */
  document.querySelector('#cliente-password-label').textContent = cliente ? 'Contraseña nueva' : 'Contraseña';
  document.querySelector('#cliente-password-ayuda').textContent = cliente
    ? 'Déjala vacía para no cambiarla.'
    : 'Si la dejas vacía se genera una temporal.';

  abrirDialogo('cliente-dialog');
  document.querySelector('#cliente-nombre').focus();
}

formularioCliente.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorCliente.hidden = true;
  marcarErrores(formularioCliente, null);

  if (!formularioCliente.reportValidity()) {
    return;
  }

  const id = document.querySelector('#cliente-id').value;
  const datos = datosDe(formularioCliente);
  const cuerpo = {
    nombre: datos.nombre,
    documento: datos.documento,
    fechaNacimiento: datos.fechaNacimiento,
    email: datos.email,
    telefono: datos.telefono || null,
    direccion: datos.direccion || null,
    activo: datos.activo,
  };
  if (datos.password) {
    cuerpo.password = datos.password;
  }

  const boton = formularioCliente.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    if (id) {
      await put(`/api/clients/${id}`, cuerpo);
      aviso('Cliente actualizado.', 'ok');
    } else {
      const respuesta = await post('/api/clients', cuerpo);
      dialogoCliente.close();
      /* La contraseña temporal solo se muestra aquí: es la única vez que sale
         en claro, y sin ella el cliente no podría entrar. */
      aviso(
        respuesta?.passwordTemporal
          ? `Cliente creado. Contraseña temporal: ${respuesta.passwordTemporal}`
          : 'Cliente creado.',
        'ok'
      );
      await cargar();
      return;
    }
    dialogoCliente.close();
    await cargar();
  } catch (error) {
    marcarErrores(formularioCliente, error, { general: errorCliente });
  } finally {
    boton.disabled = false;
  }
});

document.querySelector('#nuevo-cliente').addEventListener('click', () => abrirEditor(null));

/* ---------------- Borrar ---------------- */

async function borrar(cliente) {
  const ok = await confirmar({
    titulo: 'Eliminar cliente',
    texto: `Se eliminará la cuenta de ${cliente.nombre} (${cliente.email}).`,
    aviso: 'También desaparecen sus citas, tareas y notificaciones. No se puede deshacer.',
    textoBoton: 'Eliminar',
  });
  if (!ok) {
    return;
  }
  try {
    await del(`/api/clients/${cliente.id}`);
    aviso('Cliente eliminado.', 'ok');
    await cargar();
  } catch (error) {
    aviso(textoError(error), 'error');
  }
}

/* ---------------- Búsqueda ---------------- */

/* 250 ms: el tiempo de dejar de teclear una palabra entera. Cada tecla sería
   una petición si no se agruparan. */
let temporizador = null;

document.querySelector('#buscar').addEventListener('input', () => {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => void cargar(), 250);
});

document.querySelector('#recargar').addEventListener('click', () => void cargar());

await cargar();
