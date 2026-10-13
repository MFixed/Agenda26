/**
 * Ajustes de la cuenta (nuevo en v2).
 *
 * Tres cosas que en v1 no tenian sitio: bajar el correo (que se mandaba siempre),
 * ver desde qué dispositivos se está conectado y cerrar esas sesiones. Lo último es
 * lo que la gente busca cuando pierde el móvil o sospecha que alguien más tiene su
 * cuenta abierta, y antes no había nada que hacer.
 */
import { get, patch, del, post, exigirSesion, fechaHora, plural } from '../api.js';
import {
  aviso,
  avisoDeError,
  esqueleto,
  vacio,
  errorDeCarga,
  conectarCierres,
  montarApp,
  marcarErrores,
  limpiarErrores,
  confirmar,
} from '../ui.js';

const $ = (sel) => document.querySelector(sel);

const CLAVE_TEMA = 'agenda26_tema';

const sesion = await exigirSesion(['CLIENT']);

if (sesion) {
  montarApp(sesion, 'cliente');
  conectarCierres();

  /* ---------------- Preferencias ---------------- */

  /**
   * `settings` viene en el `sesion` del `/me`, asi que la pantalla ya se pinta con
   * los valores correctos sin esperar a una segunda peticion. Es informacion que el
   * usuario acaba de ver en la cabecera: pedirla otra vez seria un parpadeo de
   * "cargando" en algo que ya esta en la mano.
   */
  function pintarAjustes(ajustes) {
    $('#s-email').checked = ajustes?.emailOptIn ?? true;
    $('#s-theme').value = ajustes?.theme ?? 'system';
    $('#s-timezone').value = ajustes?.timezone ?? '';
  }

  $('#form-ajustes').addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const formulario = evento.target;
    const boton = $('#ajustes-guardar');

    limpiarErrores(formulario);
    boton.disabled = true;

    const cuerpo = {
      emailOptIn: $('#s-email').checked,
      theme: $('#s-theme').value,
    };

    /// La zona se manda como cadena vacia cuando se borra. El service lo traduce a
    /// NULL; mandar "" a secas seria un formato invalido.
    const zona = $('#s-timezone').value.trim();
    cuerpo.timezone = zona === '' ? null : zona;

    try {
      const respuesta = await patch('/api/auth/settings', cuerpo);

      pintarAjustes(respuesta.settings);

      /* El tema se guarda tambien en localStorage para el script que corre ANTES de
         cargar cualquier modulo. Si no, cambiarlo aqui solo se veria al recargar y
         ademas con un destello blanco de por medio. */
      try {
        localStorage.setItem(CLAVE_TEMA, respuesta.settings.theme);
        document.documentElement.setAttribute('data-theme', respuesta.settings.theme);
      } catch {
        /* Modo privado sin localStorage: el tema se aplica al recargar y ya. */
      }

      aviso('Ajustes guardados.');
    } catch (error) {
      marcarErrores(formulario, error, { general: '#ajustes-error' });
    } finally {
      boton.disabled = false;
    }
  });

  /* ---------------- Sesiones ---------------- */

  function pintarSesiones(items) {
    if (items.length === 0) {
      $('#sesiones').innerHTML = vacio('No hay sesiones abiertas.');
      return;
    }

    $('#sesiones').innerHTML = items
      .map((sesion) => {
        const dispositivo = dispositivoDe(sesion.userAgent);
        const propia = sesion.ip === sesion.user.ip;

        return `
          <article class="session-card">
            <div class="session-info">
              <strong>${dispositivo.nombre}${propia ? " <span class='badge badge--ok'>Este dispositivo</span>" : ''}</strong>
              <small>${sesion.ip ?? 'IP desconocida'} · abierta el ${fechaHora(sesion.createdAt)}</small>
            </div>
            <button class="btn btn-quiet btn-sm" data-cerrar="${sesion.id}" type="button"
                    ${propia ? "disabled title='La sesión actual se cierra al salir'" : ''}>
              Cerrar
            </button>
          </article>`;
      })
      .join('');
  }

  /**
   * Nombre legible a partir del user-agent.
   *
   * No es un detector de navegador preciso (faltarian versiones y hay docenas): es
   * para que quien mira la lista sepa si "esa" sesión es su móvil o el portátil del
   * despacho. El boton de cerrar está para cuando no lo reconoces.
   */
  function dispositivoDe(userAgent) {
    const ua = String(userAgent ?? '');

    if (!ua) return { nombre: 'Navegador desconocido' };
    if (/iPhone|iPad/i.test(ua)) return { nombre: 'iPhone o iPad' };
    if (/Android/i.test(ua)) return { nombre: 'Android' };
    if (/Macintosh|Mac OS/i.test(ua)) return { nombre: 'Mac' };
    if (/Windows/i.test(ua)) return { nombre: 'Windows' };
    if (/Linux/i.test(ua)) return { nombre: 'Linux' };

    return { nombre: 'Otro dispositivo' };
  }

  async function cargarSesiones() {
    $('#sesiones').innerHTML = esqueleto(2);

    try {
      const { items } = await get('/api/auth/sessions');
      pintarSesiones(items);
    } catch (error) {
      $('#sesiones').innerHTML = errorDeCarga();
      avisoDeError(error);
    }
  }

  $('#sesiones').addEventListener('click', async (evento) => {
    const boton = evento.target.closest('[data-cerrar]');
    if (!boton) return;

    const id = boton.dataset.cerrar;
    boton.disabled = true;

    try {
      await del(`/api/auth/sessions/${id}`);
      aviso('Sesión cerrada.');
      cargarSesiones();
    } catch (error) {
      boton.disabled = false;
      avisoDeError(error);
    }
  });

  $('#cerrar-todas').addEventListener('click', async () => {
    const aceptado = await confirmar({
      titulo: 'Cerrar todas las sesiones',
      texto: 'Se cerrarán todos los dispositivos con tu cuenta, incluido este.',
      aviso:
        'Vas a tener que entrar de nuevo aquí. Es lo que hay que hacer si crees que alguien más tiene acceso.',
      textoBoton: 'Cerrarlas todas',
    });

    if (!aceptado) return;

    try {
      await post('/api/auth/logout?todos=true', {});
      aviso('Sesiones cerradas. Vuelve a entrar.');
    } catch (error) {
      avisoDeError(error);
    }
  });

  pintarAjustes(sesion.settings);
  cargarSesiones();
}
