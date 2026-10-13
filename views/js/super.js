/**
 * Panel de la plataforma (SUPERADMIN): alta de negocios y estado de los que
 * ya existen.
 *
 * Cada empresa tiene sus administradores, sus clientes y sus citas, y no ve
 * nada de las demas. Desactivar una empresa le cierra las puertas sin borrar
 * sus datos, que es justo lo que hace falta cuando hay que parar un negocio
 * sin perderle el historico.
 */
import { esc, exigirSesion, get, patch, post, textoError } from './api.js';
import {
  aviso,
  celda,
  confirmar,
  conectarCierres,
  errorEnConfirmacion,
  esqueleto,
  montarApp,
  tabla,
} from './ui.js';

const sesion = await exigirSesion('SUPERADMIN');
if (!sesion) {
  throw new Error('sin sesion');
}

montarApp(sesion, 'super');
conectarCierres();

const contenedor = document.querySelector('#tabla-negocios');
const errorLista = document.querySelector('#lista-error');
const formulario = document.querySelector('#negocio-form');
const errorForm = document.querySelector('#form-error');

/* ---------------- Listado ---------------- */

async function cargar() {
  contenedor.innerHTML = esqueleto(3);

  try {
    const { items } = await get('/api/super/negocios');
    errorLista.hidden = true;
    pintar(items || []);
  } catch (error) {
    // Un 404 aqui significa que este rol no existe todavia en el servidor.
    // La pantalla lo dice con texto en vez de quedarse en blanco.
    contenedor.innerHTML = '';
    errorLista.textContent = textoError(error);
    errorLista.hidden = false;
  }
}

function pintar(negocios) {
  const columnas = [
    { titulo: 'Nombre' },
    { titulo: 'URL' },
    { titulo: 'Estado' },
    { titulo: 'Usuarios' },
    { titulo: 'Clientes' },
    { titulo: 'Citas' },
    { titulo: 'Administradores' },
    { titulo: '' },
  ];

  const filas = negocios.map((negocio) => [
    celda('Nombre', `<strong>${esc(negocio.nombre)}</strong>`),
    celda('URL', `<a href="/b/${encodeURIComponent(negocio.slug)}/login">/b/${esc(negocio.slug)}/login</a>`),
    celda(
      'Estado',
      negocio.activo
        ? '<span class="badge badge-active">Activo</span>'
        : '<span class="badge badge-inactive">Desactivado</span>'
    ),
    celda('Usuarios', esc(negocio.usuarios ?? 0)),
    celda('Clientes', esc(negocio.clientes ?? 0)),
    celda('Citas', esc(negocio.citas ?? 0)),
    celda('Administradores', administradoresDe(negocio)),
    celda(
      '',
      `<button class="btn btn-quiet btn-sm" data-activo="${negocio.activo ? 'false' : 'true'}" data-id="${negocio.id}" data-nombre="${esc(negocio.nombre)}">
        ${negocio.activo ? 'Desactivar' : 'Activar'}
      </button>`,
      'acciones'
    ),
  ]);

  contenedor.innerHTML = tabla(columnas, filas, {
    textoVacio:
      '<div class="empty"><strong>Aún no hay negocios</strong><span>Crea el primero con el formulario de arriba.</span></div>',
  });
}

/**
 * Quién administra la empresa. Es lo primero que hace falta cuando una se
 * queda sin acceso, asi que el correo va a la vista y no escondido en un
 * detalle.
 */
function administradoresDe(negocio) {
  if (!negocio.admins || negocio.admins.length === 0) {
    return '<span class="pill status-bad">Sin admins</span>';
  }
  return negocio.admins
    .map(
      (admin) =>
        `<div>${esc(admin.nombre)}<br><span class="muted small">${esc(admin.email)}${admin.activo ? '' : ' · desactivado'}</span></div>`
    )
    .join('');
}

/* ---------------- Activar / desactivar ---------------- */

contenedor.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('[data-activo]');
  if (!boton) {
    return;
  }

  const activar = boton.dataset.activo === 'true';
  const nombre = boton.dataset.nombre;

  const ok = await confirmar({
    titulo: activar ? 'Activar negocio' : 'Desactivar negocio',
    texto: activar ? `Se reabrirán las puertas de "${nombre}".` : `Se cerrarán las puertas de "${nombre}".`,
    aviso: activar
      ? 'Sus administradores y clientes podrán volver a entrar.'
      : 'Nadie podrá entrar hasta reactivarlo. No se borra ningún dato: citas, clientes ni historial siguen intactos.',
    textoBoton: activar ? 'Activar' : 'Desactivar',
  });

  if (!ok) {
    return;
  }

  try {
    await patch(`/api/super/negocios/${boton.dataset.id}`, { activo: activar });
    aviso(activar ? 'Negocio activado.' : 'Negocio desactivado.', 'ok');
    await cargar();
  } catch (error) {
    errorEnConfirmacion(textoError(error));
  }
});

/* ---------------- Alta de negocio ---------------- */

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorForm.hidden = true;

  if (!formulario.reportValidity()) {
    return;
  }

  const boton = formulario.querySelector('button[type="submit"]');
  boton.disabled = true;

  try {
    // El alta devuelve la puerta de entrada del negocio recién creado: es lo
    // único que quien lo dio de alta no puede inventarse despues.
    const creado = await post('/api/super/negocios', {
      nombre: formulario.nombre.value.trim(),
      slug: formulario.slug.value.trim(),
      descripcion: formulario.descripcion.value.trim(),
      adminNombre: formulario.adminNombre.value.trim(),
      adminEmail: formulario.adminEmail.value.trim(),
      adminPassword: formulario.adminPassword.value,
    });

    const puerta = creado?.negocio?.slug ? `/b/${creado.negocio.slug}/login` : '';
    aviso(creado?.mensaje || (puerta ? `Negocio creado. Entrada: ${puerta}` : 'Negocio creado.'), 'ok');

    formulario.reset();
    await cargar();
  } catch (error) {
    errorForm.textContent = textoError(error);
    errorForm.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

document.querySelector('#recargar').addEventListener('click', () => void cargar());

/* Normaliza el identificador mientras se escribe: lo que va en una URL no
   admite mayusculas ni espacios, y descubrirlo al enviar el formulario es
   una vuelta perdida. */
formulario.slug.addEventListener('input', (evento) => {
  const limpio = evento.target.value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  if (limpio !== evento.target.value) {
    evento.target.value = limpio;
  }
});

await cargar();
