/**
 * Equipo del negocio (nuevo en v2).
 *
 * En v1 no existia esta pantalla y no habia manera de dar de alta a una segunda
 * persona: el unico administrador se creaba al dar de alta la empresa, desde el
 * panel de la plataforma. Si ese unico admin se iba, la empresa se quedaba sin
 * puerta abierta.
 *
 * Aqui se crean cuentas de ADMIN (que gestionan), STAFF (que atienden) y CLIENT (que
 * piden cita). Un STAFF nace enganchado a una ficha de profesional, que es lo que
 * permite asignarle citas.
 */
import { get, post, put, del, exigirSesion, esc } from '../api.js';
import {
  aviso,
  avisoDeError,
  tabla,
  esqueleto,
  vacio,
  errorDeCarga,
  confirmar,
  conectarCierres,
  montarApp,
  abrirDialogo,
  marcarErrores,
  limpiarErrores,
} from '../ui.js';

const $ = (sel) => document.querySelector(sel);

const ROLES = {
  ADMIN: { etiqueta: 'Administrador', ayuda: 'Gestiona clientes, agenda, servicios y citas.' },
  STAFF: { etiqueta: 'Profesional', ayuda: 'Atiende citas. No ve la cartera completa.' },
  CLIENT: { etiqueta: 'Cliente', ayuda: 'Pide citas y ve las suyas. Nace con ficha.' },
};

const claseRol = (rol) =>
  rol === 'ADMIN' ? 'badge--admin' : rol === 'STAFF' ? 'badge--staff' : 'badge--client';

let filtro = '';

/**
 * Botones por fila.
 *
 * "Desactivar" y no "Eliminar": el service desactiva y revoca las sesiones, no borra
 * nada. El boton lo dice igual porque quien lo pulsa tiene que saber que la accion
 * es reversible: volver a activarla es una llamada.
 */
function acciones(usuario) {
  const alternar = usuario.activo
    ? `<button class="btn btn-quiet btn-sm" data-alta="${usuario.id}" type="button">Desactivar</button>`
    : `<button class="btn btn-quiet btn-sm" data-alta="${usuario.id}" type="button">Activar</button>`;

  const borrar = usuario.activo
    ? ''
    : `<button class="btn btn-danger btn-sm" data-borrar="${usuario.id}" type="button">Eliminar</button>`;

  return `<div class="row-actions">
      <button class="btn btn-quiet btn-sm" data-editar="${usuario.id}" type="button">Editar</button>
      ${alternar}
      ${borrar}
    </div>`;
}

function pintar(items) {
  if (items.length === 0) {
    $('#lista').innerHTML = vacio(
      filtro ? 'Nadie coincide con esa búsqueda.' : 'Todavía no hay cuentas en el equipo.'
    );
    $('#total').textContent = '';
    return;
  }

  $('#lista').innerHTML = tabla(
    ['Nombre', 'Rol', 'Email', 'Estado', 'Citas', ''],
    items.map((usuario) => [
      `<strong>${esc(usuario.nombre)}</strong>`,
      `<span class="badge ${claseRol(usuario.role)}">${esc(ROLES[usuario.role]?.etiqueta ?? usuario.role)}</span>`,
      esc(usuario.email),
      usuario.activo
        ? '<span class="badge badge--ok">Activo</span>'
        : '<span class="badge badge--off">Desactivado</span>',
      usuario.citas ?? 0,
      acciones(usuario),
    ])
  );

  $('#total').textContent = items.length === 1 ? '1 persona' : `${items.length} personas`;
}

async function cargar() {
  $('#lista').innerHTML = esqueleto(3);

  try {
    const datos = await get(`/api/users${filtro ? `?q=${encodeURIComponent(filtro)}` : ''}`);
    pintar(datos.items);
  } catch (error) {
    $('#lista').innerHTML = errorDeCarga();
    avisoDeError(error);
  }
}

/* ---------------- Formulario ---------------- */

/**
 * El dialogo se crea una vez y se reutiliza.
 *
 * Reconstruirlo en cada apertura lo haria parpadear: los campos empiezan vacios y
 * hay que volver a llenarlos. Ademas, los `addEventListener` del submit se
 * engancharian en cada apertura y el segundo guardado se ejecutaria dos veces.
 */
function asegurarDialogo() {
  if (document.querySelector('#cuenta-dialog')) return;

  const dialogo = document.createElement('dialog');
  dialogo.id = 'cuenta-dialog';
  dialogo.className = 'modal';
  dialogo.innerHTML = `
    <form id="form-cuenta" novalidate>
      <div class="modal-head">
        <div>
          <p class="eyebrow">Equipo</p>
          <h2 id="form-titulo">Añadir a alguien</h2>
        </div>
        <button class="icon-btn" type="button" data-cerrar-dialogo aria-label="Cerrar">×</button>
      </div>

      <div class="form-grid">
        <label class="field field-wide">
          <span>Nombre *</span>
          <input id="f-nombre" name="nombre" required maxlength="120" autocomplete="name">
        </label>

        <label class="field field-wide">
          <span>Email *</span>
          <input id="f-email" name="email" type="email" required maxlength="160" autocomplete="off">
        </label>

        <label class="field field-wide">
          <span>Rol *</span>
          <select id="f-rol" name="role">
            ${Object.entries(ROLES)
              .map(([valor, info]) => `<option value="${valor}">${info.etiqueta}</option>`)
              .join('')}
          </select>
          <small id="ayuda-rol">${ROLES.STAFF.ayuda}</small>
        </label>

        <label class="field field-wide">
          <span>Teléfono</span>
          <input id="f-telefono" name="telefono" maxlength="30" autocomplete="tel">
        </label>

        <label class="field field-wide">
          <span id="rotulo-password">Contraseña</span>
          <input id="f-password" name="password" type="password" minlength="8" autocomplete="new-password">
          <small>Mínimo 8 caracteres, con mayúscula, minúscula y número. Vacío = temporal.</small>
        </label>
      </div>

      <p class="form-error" id="form-error" role="alert" hidden></p>

      <div class="modal-actions">
        <button class="btn btn-quiet" type="button" data-cerrar-dialogo>Cancelar</button>
        <button class="btn btn-primary" type="submit" id="f-enviar">Crear cuenta</button>
      </div>
    </form>`;

  document.body.append(dialogo);

  document.querySelector('#f-rol').addEventListener('change', (evento) => {
    document.querySelector('#ayuda-rol').textContent = ROLES[evento.target.value].ayuda;
  });

  document.querySelector('#form-cuenta').addEventListener('submit', enviar);
}

function abrirFormulario(usuario) {
  asegurarDialogo();

  const editando = Boolean(usuario);
  const formulario = document.querySelector('#form-cuenta');

  formulario.dataset.id = editando ? usuario.id : '';

  document.querySelector('#form-titulo').textContent = editando
    ? `Editar a ${usuario.nombre}`
    : 'Añadir a alguien al equipo';

  document.querySelector('#f-enviar').textContent = editando ? 'Guardar cambios' : 'Crear cuenta';

  document.querySelector('#f-nombre').value = usuario?.nombre ?? '';
  document.querySelector('#f-email').value = usuario?.email ?? '';
  document.querySelector('#f-telefono').value = usuario?.telefono ?? '';
  document.querySelector('#f-password').value = '';

  document.querySelector('#rotulo-password').textContent = editando ? 'Nueva contraseña' : 'Contraseña';

  /*
   * El email y el rol no se editan.
   *
   * Cambiar el email es delicado (es la identidad de la cuenta) y cambiar el rol por
   * la puerta de atras daria privilegios sin pasar por el panel de la plataforma. El
   * service los ignora; aqui se deshabilitan para que se vea a que no se puede, en
   * vez de dejar escribir algo que luego se pierde en silencio.
   */
  const email = document.querySelector('#f-email');
  const rol = document.querySelector('#f-rol');

  email.disabled = editando;
  rol.disabled = editando;
  rol.value = usuario?.role ?? 'STAFF';

  const error = document.querySelector('#form-error');
  error.hidden = true;
  error.textContent = '';

  abrirDialogo('cuenta-dialog');
  document.querySelector('#f-nombre').focus();
}

async function enviar(evento) {
  evento.preventDefault();

  const formulario = evento.target;
  const id = formulario.dataset.id;
  const boton = document.querySelector('#f-enviar');

  limpiarErrores(formulario);

  const datos = {
    nombre: document.querySelector('#f-nombre').value.trim(),
    telefono: document.querySelector('#f-telefono').value.trim(),
    password: document.querySelector('#f-password').value,
  };

  if (!id) {
    datos.email = document.querySelector('#f-email').value.trim();
    datos.role = document.querySelector('#f-rol').value;
  }

  boton.disabled = true;

  try {
    if (id) {
      await put(`/api/users/${id}`, datos);
      aviso('Cuenta actualizada.');
    } else {
      const respuesta = await post('/api/users', datos);
      aviso('Cuenta creada.');

      /*
       * La contraseña temporal solo se devuelve aquí y en ningún otro sitio. Después
       * es ilegible por diseño, así que si se pierde hay que dar de baja la cuenta y
       * crear otra.
       */
      if (respuesta.passwordTemporal) {
        mostrarTemporal(respuesta.passwordTemporal, datos.email);
      }
    }

    formulario.closest('dialog').close();
    cargar();
  } catch (error) {
    marcarErrores(formulario, error, { general: '#form-error' });
  } finally {
    boton.disabled = false;
  }
}

/**
 * La contraseña temporal, en grande y con un botón para copiarla.
 *
 * Va en un diálogo aparte y no en un aviso flotante: un aviso se va solo a los
 * cuatro segundos, y una contraseña que desaparece antes de copiarla obliga a crear
 * otra cuenta entera.
 */
function mostrarTemporal(clave, email) {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'modal';
  dialogo.innerHTML = `
    <div class="modal-head">
      <div>
        <p class="eyebrow">Cuenta creada</p>
        <h2>Contraseña temporal</h2>
      </div>
      <button class="icon-btn" type="button" data-cerrar-dialogo aria-label="Cerrar">×</button>
    </div>

    <p class="note">Para <strong>${esc(email)}</strong>. Cópiala y entrégasela: no vuelve a mostrarse.</p>

    <div class="temporal">
      <code class="temporal-clave" id="clave-temporal">${esc(clave)}</code>
      <button class="btn btn-primary" id="copiar-clave" type="button">Copiar</button>
    </div>

    <p class="note">Pide al cliente que la cambie al entrar, desde su perfil. Y que la cambie pronto: esta contraseña se la sabe quien la lea.</p>

    <div class="modal-actions">
      <button class="btn btn-primary" type="button" data-cerrar-dialogo>Hecho</button>
    </div>`;

  document.body.append(dialogo);

  dialogo.querySelector('#copiar-clave').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(clave);
      aviso('Copiada al portapapeles.');
    } catch {
      aviso('No se ha podido copiar. Cópiala a mano.', 'error');
    }
  });

  dialogo.addEventListener('close', () => dialogo.remove());

  dialogo.showModal();
}

/* ---------------- Acciones sobre una fila ---------------- */

async function alternarActivo(usuario) {
  const verbando = usuario.activo;

  const aceptado = await confirmar({
    titulo: verbando ? 'Desactivar la cuenta' : 'Activar la cuenta',
    texto: `${verbando ? 'Desactivar' : 'Activar'} la cuenta de ${usuario.nombre}.`,
    aviso: verbando
      ? 'Dejará de poder entrar y se cerrarán sus sesiones abiertas. Los datos se conservan.'
      : 'Volverá a poder entrar con su correo y contraseña.',
    textoBoton: verbando ? 'Desactivar' : 'Activar',
  });

  if (!aceptado) return;

  try {
    await put(`/api/users/${usuario.id}`, { activo: !usuario.activo });
    aviso(verbando ? 'Cuenta desactivada.' : 'Cuenta activada.');
    cargar();
  } catch (error) {
    avisoDeError(error);
  }
}

async function eliminar(usuario) {
  const aceptado = await confirmar({
    titulo: 'Eliminar la cuenta',
    texto: `Eliminar a ${usuario.nombre} y su ficha de cliente.`,
    aviso:
      'Esta acción no se puede deshacer. Si solo quieres quitarle el acceso, desactiva la cuenta en su lugar.',
    textoBoton: 'Eliminar',
  });

  if (!aceptado) return;

  try {
    await del(`/api/users/${usuario.id}`);
    aviso('Cuenta eliminada.');
    cargar();
  } catch (error) {
    avisoDeError(error);
  }
}

/* ---------------- Arranque ---------------- */

const sesion = await exigirSesion(['ADMIN', 'SUPERADMIN']);

if (sesion) {
  montarApp(sesion, 'admin');
  conectarCierres();

  $('#nuevo').addEventListener('click', () => abrirFormulario(null));

  let temporizador;

  $('#buscar').addEventListener('input', (evento) => {
    filtro = evento.target.value.trim();
    clearTimeout(temporizador);
    temporizador = setTimeout(cargar, 300);
  });

  $('#lista').addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button');
    if (!boton) return;

    const id = boton.dataset.editar ?? boton.dataset.alta ?? boton.dataset.borrar;
    if (!id) return;

    try {
      const { usuario } = await get(`/api/users/${id}`);

      if (boton.dataset.editar !== undefined) {
        abrirFormulario(usuario);
      } else if (boton.dataset.alta !== undefined) {
        await alternarActivo(usuario);
      } else if (boton.dataset.borrar !== undefined) {
        await eliminar(usuario);
      }
    } catch (error) {
      avisoDeError(error);
    }
  });

  cargar();
}
