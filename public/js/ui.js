/**
 * Piezas de interfaz reutilizadas por varias páginas: cabecera con el menú del
 * rol, campana de notificaciones, modal de detalle y confirmaciones.
 *
 * Aquí no hay reglas de negocio: sólo presentación y eventos. Quien llama es el
 * que decide qué se puede hacer.
 */
import {
  ESTADOS_CITA,
  esc,
  fecha,
  fechaHora,
  get,
  iniciales,
  insignia,
  put,
  textoError,
  toast
} from "./api.js";

/* ---------------- Cabecera ---------------- */

/**
 * Marca el enlace activo según la ruta actual y pinta el nombre del usuario.
 * Se llama desde el script de cada página.
 */
export function montarCabecera(sesion) {
  const chip = document.querySelector("#user-name");
  if (chip) {
    chip.textContent = sesion.user.nombre;
  }

  const insigniaRol = document.querySelector("#rol-badge");
  if (insigniaRol) {
    insigniaRol.textContent = sesion.user.role === "ADMIN" ? "Administración" : "Cliente";
    insigniaRol.classList.add(sesion.user.role === "ADMIN" ? "badge-admin" : "badge-cliente");
  }

  const actual = window.location.pathname;
  for (const enlace of document.querySelectorAll(".nav-links a")) {
    const destino = enlace.getAttribute("href");
    if (destino === actual || (destino !== "/" && actual.startsWith(destino))) {
      enlace.classList.add("active");
    } else {
      enlace.classList.remove("active");
    }
  }

  montarNotificaciones(sesion);
}

/* ---------------- Notificaciones ---------------- */

async function montarNotificaciones(sesion) {
  const campana = document.querySelector("#notificaciones");
  if (!campana) {
    return;
  }

  const pintar = async () => {
    try {
      const { items, noLeidas } = await get("/api/notifications?limit=8");
      campana.dataset.total = String(noLeidas);
      const globo = campana.querySelector("#notificaciones-total");
      if (globo) {
        globo.textContent = noLeidas > 9 ? "9+" : String(noLeidas);
        globo.hidden = noLeidas === 0;
      }

      const lista = campana.querySelector("#notificaciones-lista");
      if (!lista) {
        return;
      }
      lista.innerHTML =
        items.length === 0
          ? '<p class="muted" style="padding:.5rem">No hay avisos.</p>'
          : items
              .map(
                (aviso) => `
        <button class="notification-row${aviso.leida ? " leida" : ""}" type="button" data-id="${aviso.id}">
          <span class="notification-dot" aria-hidden="true"></span>
          <span class="notification-body">
            <strong>${esc(aviso.title)}</strong>
            <small>${esc(aviso.message)}</small>
            <time>${esc(fechaHora(aviso.createdAt))}</time>
          </span>
        </button>`
              )
              .join("");
    } catch {
      // Un fallo al cargar la campana no debe romper la página.
    }
  };

  const boton = campana.querySelector("button");
  if (boton) {
    boton.addEventListener("click", () => {
      const abierto = campana.classList.toggle("abierta");
      boton.setAttribute("aria-expanded", String(abierto));
      if (abierto) {
        void pintar();
      }
    });
  }

  const marcarTodas = campana.querySelector("#notificaciones-todas");
  if (marcarTodas) {
    marcarTodas.addEventListener("click", async () => {
      try {
        await put("/api/notifications/read-all");
        await pintar();
        toast("Notificaciones marcadas como leídas.");
      } catch (error) {
        toast(textoError(error), true);
      }
    });
  }

  campana.addEventListener("click", async (evento) => {
    const fila = evento.target.closest(".notification-row");
    if (!fila) {
      return;
    }
    try {
      await put(`/api/notifications/${fila.dataset.id}/read`);
      await pintar();
    } catch (error) {
      toast(textoError(error), true);
    }
  });

  // Clic fuera para cerrar el desplegable.
  document.addEventListener("click", (evento) => {
    if (!campana.contains(evento.target)) {
      campana.classList.remove("abierta");
      boton?.setAttribute("aria-expanded", "false");
    }
  });

  void sesion;
  await pintar();
}

/* ---------------- Modal ---------------- */

/** Abre un <dialog> y devuelve su contenido, para poder rellenar y listenar. */
export function abrirDialogo(id) {
  const dialogo = document.querySelector(`#${id}`);
  if (dialogo && !dialogo.open) {
    dialogo.showModal();
  }
  return dialogo;
}

export function cerrarDialogo(id) {
  document.querySelector(`#${id}`)?.close();
}

/* ---------------- Confirmación ---------------- */

/**
 * Confirmación reutilizable. Devuelve una promesa que resuelve a true si el
 * usuario confirma. Se usa para borrar, no para decisiones de negocio.
 */
export function confirmar({ titulo, texto, aviso, textoBoton = "Eliminar" }) {
  return new Promise((resolver) => {
    const dialogo = document.querySelector("#confirm-dialog");
    if (!dialogo) {
      resolver(window.confirm(texto));
      return;
    }

    dialogo.querySelector("#confirm-title").textContent = titulo;
    dialogo.querySelector("#confirm-text").textContent = texto;
    dialogo.querySelector(".confirm-warn").textContent = aviso;
    const aceptar = dialogo.querySelector("#accept-confirm");
    aceptar.textContent = textoBoton;
    const error = dialogo.querySelector("#confirm-message");
    error.textContent = "";

    const cerrar = () => {
      dialogo.close();
      dialogo.removeEventListener("close", alCerrar);
      aceptar.removeEventListener("click", alAceptar);
    };
    const alAceptar = () => {
      cerrar();
      resolver(true);
    };
    const alCerrar = () => {
      aceptar.removeEventListener("click", alAceptar);
      resolver(false);
    };

    aceptar.addEventListener("click", alAceptar);
    dialogo.addEventListener("close", alCerrar);
    dialogo.showModal();
  });
}

/** Muestra un error dentro del diálogo de confirmación, sin cerrarlo. */
export function errorEnConfirmacion(texto) {
  const destino = document.querySelector("#confirm-message");
  if (destino) {
    destino.textContent = texto;
    destino.classList.add("error");
  }
}

/* ---------------- Piezas de render ---------------- */

export function avatar(nombre, grande = false) {
  return `<span class="avatar${grande ? " avatar-lg" : ""}" aria-hidden="true">${esc(iniciales(nombre))}</span>`;
}

export function vacio(titulo, detalle) {
  return `<div class="empty-state"><strong>${esc(titulo)}</strong>${esc(detalle || "")}</div>`;
}

/** Ficha de datos en modo sólo lectura, el formato del modal de detalle. */
export function dato(etiqueta, valor, ancho = false) {
  const contenido = valor ? esc(valor) : '<em>Sin datos</em>';
  return `
    <div class="detail-item${ancho ? " detail-item-wide" : ""}">
      <span>${esc(etiqueta)}</span>
      <strong>${contenido}</strong>
    </div>`;
}

/** Línea de cita para listas: la usan el panel y el calendario. */
export function filaCita(cita, { conAcciones = false } = {}) {
  return `
    <article class="appointment-row" data-id="${cita.id}">
      <div class="appointment-main">
        <span class="appointment-when">${esc(cita.task?.title || "Cita")}</span>
        <span class="appointment-meta">
          ${esc(fecha(cita.availability?.date))} · ${esc(cita.availability?.startTime || "")}–${esc(cita.availability?.endTime || "")}
          · ${esc(cita.task?.category?.name || "Sin categoría")}
        </span>
        ${cita.note ? `<p class="appointment-note">${esc(cita.note)}</p>` : ""}
      </div>
      ${insignia(cita.status, ESTADOS_CITA)}
      ${conAcciones ? '<div class="appointment-actions"></div>' : ""}
    </article>`;
}
