/**
 * Informes del negocio (nuevo en v2).
 *
 * Cada informe es un endpoint distinto y cada uno dibuja su propia tabla. Se piden
 * todos en paralelo con `Promise.all`: son cinco peticiones a una API local y montar
 * la pantalla de a uno se nota como un parpadeo de "cargando" entre secciones.
 *
 * El rango por defecto es "el último año" y no "este mes": un informe de ocupación de
 * un mes casi siempre sale pequeño y hay que agrandarlo, que es un paso de más. En
 * `report.service.js` el rango está acotado a 2 años justamente para que no se pueda
 * pedir "todo" y dejar la base leyendo durante un minuto.
 */
import { get, exigirSesion, hoy, sumarDias, plural } from '../api.js';
import {
  aviso,
  avisoDeError,
  tabla,
  esqueleto,
  vacio,
  errorDeCarga,
  conectarCierres,
  montarApp,
} from '../ui.js';

const $ = (sel) => document.querySelector(sel);

let rango = { desde: sumarDias(hoy(), -365), hasta: hoy() };

/* ---------------- Pintado ---------------- */

function tarjeta(etiqueta, valor, pie, tono = '') {
  return `
    <article class="stat-card ${tono}">
      <span>${etiqueta}</span>
      <strong>${valor}</strong>
      <small>${pie}</small>
    </article>`;
}

function pintarResumen(resumen) {
  const c = resumen.citas;
  const o = resumen.ocupacion;

  $('#stats').innerHTML = [
    tarjeta('Citas en el rango', c.total, plural(c.total, 'cita', 'citas'), 'stat-card--info'),
    tarjeta('Realizadas', `${o.tasaRealizacion}%`, `${c.completadas} completadas`, 'stat-card--success'),
    tarjeta('Pendientes', c.pendientes, 'esperan respuesta', 'stat-card--warning'),
    tarjeta('Ausencias', `${o.tasaAusencia}%`, plural(c.ausencias, 'no asistió', 'no asistieron')),
    tarjeta('Ocupación', `${o.porcentajeOcupado}%`, `${o.huecosPublicados} huecos publicados`),
    tarjeta('Clientes atendidos', resumen.clientes.activos, 'con al menos una cita'),
  ].join('');
}

/**
 * Ocupación por día, como barras en CSS y no con canvas.
 *
 * El dato es "una barra por día" y el CSS lo pinta en veinte líneas, sin librerías.
 * Además el ancho real está en el `title`, así que el número exacto se lee al pasar
 * el ratón y también lo lee un lector de pantalla, que con un canvas no lo haría.
 */
function pintarOcupacion(ocupacion) {
  if (ocupacion.items.length === 0) {
    $('#ocupacion').innerHTML = vacio('No hay agenda publicada para este rango.');
    return;
  }

  $('#ocupacion').innerHTML = ocupacion.items
    .map((dia) => {
      const tono = dia.porcentaje >= 80 ? 'alta' : dia.porcentaje >= 40 ? 'media' : 'baja';

      return `
        <div class="bar-row">
          <span class="bar-label">${dia.fecha}</span>
          <span class="bar-track">
            <span class="bar-fill ${tono}" style="width:${Math.min(dia.porcentaje, 100)}%"
                  title="${dia.ocupados} de ${dia.huecos} huecos (${dia.porcentaje}%)"></span>
          </span>
          <span class="bar-value">${dia.porcentaje}%</span>
        </div>`;
    })
    .join('');
}

function pintarServicios(servicios) {
  if (servicios.items.length === 0) {
    $('#servicios').innerHTML = vacio('No hay citas en este rango.');
    return;
  }

  $('#servicios').innerHTML = tabla(
    ['Servicio', 'Categoría', 'Citas', '% del total', 'Ingreso estimado'],
    servicios.items.map((item) => [
      `<strong>${item.titulo}</strong>`,
      item.categoria ?? '—',
      item.citas,
      `${item.porcentaje}%`,
      item.ingresoEstimado !== null ? `${item.ingresoEstimado.toFixed(2)}` : '—',
    ])
  );
}

function pintarMotivos(cancelaciones) {
  if (cancelaciones.items.length === 0) {
    $('#motivos').innerHTML = vacio('No hay cancelaciones en este rango.');
    return;
  }

  $('#motivos').innerHTML =
    tabla(
      ['Motivo', 'Citas', '% del total'],
      cancelaciones.items.map((item) => [item.motivo, item.citas, `${item.porcentaje}%`])
    ) + `<p class="table-note">${cancelaciones.total} cancelaciones en total.</p>`;
}

function pintarAusencias(ausencias) {
  if (ausencias.items.length === 0) {
    $('#ausencias').innerHTML = vacio('Ningún cliente se ha ausentado en este rango.');
    return;
  }

  $('#ausencias').innerHTML =
    tabla(
      ['Profesional', 'Ausencias', '% sobre citas cerradas'],
      ausencias.items.map((item) => [item.nombre, item.ausencias, `${ausencias.porcentaje}%`])
    ) +
    `<p class="table-note">${ausencias.totalAusencias} ausencias sobre ${ausencias.totalCerradas} citas cerradas.</p>`;
}

/* ---------------- Carga ---------------- */

async function cargar() {
  $('#stats').innerHTML = esqueleto(6);
  $('#ocupacion').innerHTML = esqueleto(1);
  $('#servicios').innerHTML = esqueleto(1);
  $('#motivos').innerHTML = esqueleto(1);
  $('#ausencias').innerHTML = esqueleto(1);

  const donde = new URLSearchParams(rango).toString();

  try {
    /*
     * `Promise.all` y no `allSettled`: si el panel de ocupación falla, mostrar el
     * resto con huecos vacíos y un aviso por sección sería peor que no mostrar nada
     * y decir que algo falló. Aquí va la pantalla entera o va el error.
     */
    const [resumen, ocupacion, servicios, motivos, ausencias] = await Promise.all([
      get(`/api/reports/overview?${donde}`),
      get(`/api/reports/occupancy?${donde}`),
      get(`/api/reports/services?${donde}`),
      get(`/api/reports/cancellations?${donde}`),
      get(`/api/reports/no-show?${donde}`),
    ]);

    pintarResumen(resumen);
    pintarOcupacion(ocupacion);
    pintarServicios(servicios);
    pintarMotivos(motivos);
    pintarAusencias(ausencias);

    $('#rango-label').textContent = `Del ${rango.desde} al ${rango.hasta}`;
  } catch (error) {
    $('#stats').innerHTML = errorDeCarga();
    avisoDeError(error);
  }
}

/* ---------------- Arranque ---------------- */

const sesion = await exigirSesion(['ADMIN', 'SUPERADMIN']);

if (sesion) {
  montarApp(sesion, 'adminAmplio');
  conectarCierres();

  $('#desde').value = rango.desde;
  $('#hasta').value = rango.hasta;

  $('#aplicar').addEventListener('click', () => {
    const desde = $('#desde').value;
    const hasta = $('#hasta').value;

    if (!desde || !hasta) {
      aviso('Elige las dos fechas.', 'error');
      return;
    }

    if (desde > hasta) {
      aviso('La fecha inicial tiene que ser anterior a la final.', 'error');
      return;
    }

    rango = { desde, hasta };
    cargar();
  });

  /**
   * `location.href` y no un fetch con Blob.
   *
   * La respuesta ya viene con `Content-Disposition: attachment`, así que el navegador
   * la guarda sin construir un Blob en memoria, sin darle nombre al archivo y sin
   * mirar el tipo de contenido. Menos código y exactamente el mismo resultado.
   */
  $('#exportar').addEventListener('click', () => {
    window.location.href = `/api/reports/export?${new URLSearchParams(rango).toString()}`;
  });

  cargar();
}
