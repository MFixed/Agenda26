/**
 * Listado de tareas del administrador con las vistas de §13, alta y edición, y
 * las categorías como ventana aparte.
 *
 * La vista por defecto es "Mis tareas" (alcance=propias): las sueltas del
 * administrador. Cada cita registrada genera también una tarea, y esas ya se
 * gestionan en "Citas" y en el calendario, así que en la lista de trabajo se
 * apartan. "Todas" y "De citas" las traen de vuelta.
 */
import {
  ESTADOS_TAREA,
  conectarSalir,
  datosDe,
  del,
  esc,
  exigirSesion,
  fecha,
  get,
  insignia,
  post,
  put,
  toast,
  textoError
} from "../api.js";
import { confirmar, dato, montarCabecera, vacio } from "../ui.js";

const sesion = await exigirSesion("ADMIN");
montarCabecera(sesion);
conectarSalir();

const parametros = new URLSearchParams(window.location.search);
const filtros = {
  vista: parametros.get("vista") || "propias",
  estado: "",
  categoryId: "",
  q: ""
};

const lista = document.querySelector("#lista-tareas");
const mensajeLista = document.querySelector("#lista-message");
const dialogoTarea = document.querySelector("#tarea-dialog");
const formularioTarea = document.querySelector("#tarea-form");
const errorTarea = document.querySelector("#tarea-error");
const dialogoCategoria = document.querySelector("#categoria-dialog");
const formularioCategoria = document.querySelector("#categoria-form");
const errorCategoria = document.querySelector("#categoria-error");

let categorias = [];
let clientes = [];

/* ---------------- Vistas ---------------- */

/**
 * "propias" es la vista por defecto: las tareas sueltas del administrador. Las
 * que nacen al registrar una cita se gestionan en "Citas", así que en la lista
 * de trabajo no ensucian. "de-citas" las deja a la vista cuando hacen falta.
 */
const VISTAS = {
  propias: { etiqueta: "Mis tareas", params: { alcance: "propias" } },
  todas: { etiqueta: "Todas", params: {} },
  agendadas: { etiqueta: "Agendadas", params: { alcance: "propias", filtro: "agendadas" } },
  "sin-fecha": { etiqueta: "Sin fecha", params: { alcance: "propias", filtro: "sin-fecha" } },
  pendientes: { etiqueta: "Pendientes", params: { alcance: "propias", filtro: "pendientes" } },
  completadas: { etiqueta: "Completadas", params: { alcance: "propias", filtro: "completadas" } },
  "de-citas": { etiqueta: "De citas", params: { alcance: "de-citas" } }
};

// Una vista inventada en la URL cae en la de por defecto en vez de romper.
if (!VISTAS[filtros.vista]) {
  filtros.vista = "propias";
}

/** Los contadores de las tarjetas respetan el alcance de la vista activa. */
function alcanceDeLaVista() {
  return VISTAS[filtros.vista].params.alcance || "";
}

function marcarVistaActiva() {
  for (const enlace of document.querySelectorAll(".tabs .tab")) {
    const vista = new URLSearchParams(enlace.href.split("?")[1]).get("vista");
    enlace.classList.toggle("active", vista === filtros.vista);
  }
}

async function cargar() {
  marcarVistaActiva();

  const alcance = alcanceDeLaVista();

  const query = new URLSearchParams({ limit: "200" });
  for (const [clave, valor] of Object.entries(VISTAS[filtros.vista].params)) {
    query.set(clave, valor);
  }
  if (filtros.estado) query.set("estado", filtros.estado);
  if (filtros.categoryId) query.set("categoryId", filtros.categoryId);
  if (filtros.q) query.set("q", filtros.q);

  // Las tarjetas de resumen se cuentan siempre dentro del alcance de la vista,
  // para que el "Total" de arriba no sea el de una lista que no se está viendo.
  const conAlcance = (extra) => {
    const p = new URLSearchParams({ ...(alcance ? { alcance } : {}), ...extra, limit: "1" });
    return `/api/tasks?${p}`;
  };

  try {
    const [datos, sinFecha, pendientes, completadas, deCitas] = await Promise.all([
      get(`/api/tasks?${query}`),
      get(conAlcance({ filtro: "sin-fecha" })),
      get(conAlcance({ filtro: "pendientes" })),
      get(conAlcance({ filtro: "completadas" })),
      get("/api/tasks?alcance=de-citas&limit=1")
    ]);

    document.querySelector("#stat-total").textContent = datos.total;
    document.querySelector("#stat-sin-fecha").textContent = sinFecha.total;
    document.querySelector("#stat-pendientes").textContent = pendientes.total;
    document.querySelector("#stat-completadas").textContent = completadas.total;
    mensajeLista.textContent = "";

    // Aviso de lo que queda fuera: las tareas que nacen de una cita se ven en
    // "Citas", y aquí sólo se esconden si la vista no es "todas".
    const ocultas = document.querySelector("#ocultas");
    if (alcance === "propias" && deCitas.total > 0) {
      ocultas.hidden = false;
      ocultas.querySelector("span").textContent =
        `${deCitas.total} tarea${deCitas.total === 1 ? "" : "s"} de citas quedan fuera de esta lista`;
    } else {
      ocultas.hidden = true;
    }

    lista.innerHTML = datos.items.length === 0 ? vacio("Sin tareas", "Cambia de vista o crea una nueva.") : datos.items.map(filaTarea).join("");

    for (const fila of lista.querySelectorAll("[data-id]")) {
      fila.addEventListener("click", (evento) => {
        if (evento.target.closest("button[data-accion]")) {
          return;
        }
        void abrirDetalle(Number(fila.dataset.id));
      });
    }
  } catch (error) {
    lista.innerHTML = "";
    mensajeLista.textContent = textoError(error);
    mensajeLista.classList.add("error");
  }
}

function filaTarea(tarea) {
  const acento = {
    PENDING: "var(--primary)",
    IN_PROGRESS: "var(--warning)",
    COMPLETED: "var(--success)",
    CANCELLED: "var(--muted)"
  }[tarea.status];

  const fechaTexto = tarea.sinFecha
    ? '<span class="task-sin-fecha">Sin fecha</span>'
    : `${esc(fecha(tarea.dueDate))}${tarea.dueTime ? ` · ${esc(tarea.dueTime)}` : ""}`;

  const meta = [
    fechaTexto,
    tarea.category ? `<span class="chip">${esc(tarea.category.name)}</span>` : "",
    tarea.client ? `<span class="chip">${esc(tarea.client.nombre)}</span>` : "",
    tarea.citas ? `<span class="chip">${tarea.citas} cita${tarea.citas === 1 ? "" : "s"}</span>` : ""
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="task-row${tarea.status === "COMPLETED" ? " done" : ""}"
             data-id="${tarea.id}" tabindex="0" role="button" style="--accent:${acento}">
      <span aria-hidden="true">${tarea.status === "COMPLETED" ? "✅" : "•"}</span>
      <div>
        <span class="task-title">${esc(tarea.title)}</span>
        <span class="task-meta">${meta}</span>
      </div>
      <div class="task-actions">
        ${insignia(tarea.status, ESTADOS_TAREA)}
        <button class="icon-button" type="button" data-accion="editar" aria-label="Editar">✎</button>
        <button class="icon-button danger" type="button" data-accion="borrar" aria-label="Eliminar">×</button>
      </div>
    </article>`;
}

/* ---------------- Detalle ---------------- */

async function abrirDetalle(id) {
  const dialogo = document.querySelector("#detalle-dialog");
  let tarea;
  try {
    ({ tarea } = await get(`/api/tasks/${id}`));
  } catch (error) {
    toast(textoError(error), true);
    return;
  }

  dialogo.innerHTML = `
    <div class="modal-body">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Tarea #${tarea.id}</p>
          <h2 id="detalle-title">${esc(tarea.title)}</h2>
        </div>
        <button class="icon-button" data-cerrar type="button" aria-label="Cerrar">×</button>
      </div>

      <div class="detail-grid">
        ${dato("Estado", "")}
        ${dato("Categoría", tarea.category?.name)}
        ${dato("Fecha", tarea.sinFecha ? "Sin fecha" : fecha(tarea.dueDate))}
        ${dato("Hora", tarea.dueTime || "")}
        ${dato("Cliente", tarea.client?.nombre)}
        ${dato("Citas", tarea.citas ?? "")}
        ${dato("Creada", tarea.createdAt)}
        ${dato("Modificada", tarea.updatedAt)}
        ${dato("Descripción", tarea.description || "", true)}
      </div>

      <div class="modal-foot">
        <button class="button button-primary button-sm" data-editar type="button">Editar</button>
        <button class="button button-danger button-sm" data-borrar type="button">Eliminar</button>
      </div>
    </div>`;

  dialogo.querySelector("[data-cerrar]").addEventListener("click", () => dialogo.close());
  dialogo.querySelector("[data-editar]").addEventListener("click", () => {
    dialogo.close();
    abrirEditor(tarea);
  });
  dialogo.querySelector("[data-borrar]").addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "Eliminar tarea",
      texto: `"${tarea.title}" se eliminará.`,
      aviso: "Si tiene citas asociadas, también se borran. Esta acción no se puede deshacer.",
      textoBoton: "Eliminar"
    });
    if (!ok) {
      return;
    }
    try {
      await del(`/api/tasks/${tarea.id}`);
      dialogo.close();
      toast("Tarea eliminada.");
      await cargar();
    } catch (error) {
      toast(textoError(error), true);
    }
  });

  dialogo.showModal();
}

/* ---------------- Editor de tarea ---------------- */

async function cargarOpciones() {
  [categorias, clientes] = await Promise.all([
    get("/api/categories").then((r) => r.items),
    get("/api/clients?limit=200").then((r) => r.items)
  ]);

  document.querySelector("#tarea-categoria").innerHTML =
    '<option value="">Sin categoría</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join("");

  document.querySelector("#tarea-cliente").innerHTML =
    '<option value="">Sin cliente</option>' +
    clientes.map((cliente) => `<option value="${cliente.id}">${esc(cliente.nombre)}</option>`).join("");

  const filtroCategoria = document.querySelector("#filtro-categoria");
  filtroCategoria.innerHTML =
    '<option value="">Todas las categorías</option>' +
    categorias.map((categoria) => `<option value="${categoria.id}">${esc(categoria.name)}</option>`).join("");
}

function abrirEditor(tarea) {
  formularioTarea.reset();
  errorTarea.hidden = true;

  const id = tarea ? tarea.id : "";
  document.querySelector("#tarea-id").value = id;
  document.querySelector("#tarea-dialog-title").textContent = tarea ? "Editar tarea" : "Nueva tarea";
  document.querySelector("#tarea-titulo").value = tarea?.title || "";
  document.querySelector("#tarea-descripcion").value = tarea?.description || "";
  document.querySelector("#tarea-categoria").value = tarea?.categoryId || "";
  document.querySelector("#tarea-cliente").value = tarea?.clientId || "";
  document.querySelector("#tarea-fecha").value = tarea?.sinFecha ? "" : tarea?.dueDate || "";
  document.querySelector("#tarea-hora").value = tarea?.dueTime || "";
  document.querySelector("#tarea-estado").value = tarea?.status || "PENDING";

  dialogoTarea.showModal();
  document.querySelector("#tarea-titulo").focus();
}

formularioTarea.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorTarea.hidden = true;
  if (!formularioTarea.reportValidity()) {
    return;
  }

  const id = document.querySelector("#tarea-id").value;
  const datos = datosDe(formularioTarea);
  const cuerpo = {
    title: datos.title,
    description: datos.description || null,
    categoryId: datos.categoryId ? Number(datos.categoryId) : null,
    clientId: datos.clientId ? Number(datos.clientId) : null,
    // Vacío explícito => NULL, que es la vista "sin fecha".
    dueDate: datos.dueDate || null,
    dueTime: datos.dueTime || null,
    status: datos.status
  };

  try {
    if (id) {
      await put(`/api/tasks/${id}`, cuerpo);
      toast("Tarea actualizada.");
    } else {
      await post("/api/tasks", cuerpo);
      toast("Tarea creada.");
    }
    dialogoTarea.close();
    await cargar();
  } catch (error) {
    errorTarea.textContent = textoError(error);
    errorTarea.hidden = false;
  }
});

document.querySelector("#nueva-tarea").addEventListener("click", () => abrirEditor(null));
document.querySelector("#close-tarea-dialog").addEventListener("click", () => dialogoTarea.close());
document.querySelector("#cancel-tarea-dialog").addEventListener("click", () => dialogoTarea.close());

/* Acciones de la fila: editar o borrar sin abrir el detalle. */
lista.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("button[data-accion]");
  if (!boton) {
    return;
  }
  const id = Number(boton.closest("[data-id]").dataset.id);

  if (boton.dataset.accion === "editar") {
    const { tarea } = await get(`/api/tasks/${id}`);
    abrirEditor(tarea);
    return;
  }

  const { tarea } = await get(`/api/tasks/${id}`);
  const ok = await confirmar({
    titulo: "Eliminar tarea",
    texto: `"${tarea.title}" se eliminará.`,
    aviso: "Si tiene citas asociadas, también se borran.",
    textoBoton: "Eliminar"
  });
  if (!ok) {
    return;
  }
  try {
    await del(`/api/tasks/${id}`);
    toast("Tarea eliminada.");
    await cargar();
  } catch (error) {
    toast(textoError(error), true);
  }
});

/* ---------------- Categorías ---------------- */

function abrirEditorCategoria(categoria) {
  formularioCategoria.reset();
  errorCategoria.hidden = true;
  document.querySelector("#categoria-id").value = categoria ? categoria.id : "";
  document.querySelector("#categoria-dialog-title").textContent = categoria ? "Editar categoría" : "Nueva categoría";
  document.querySelector("#categoria-nombre").value = categoria?.name || "";
  document.querySelector("#categoria-descripcion").value = categoria?.description || "";
  dialogoCategoria.showModal();
}

formularioCategoria.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  errorCategoria.hidden = true;
  if (!formularioCategoria.reportValidity()) {
    return;
  }

  const id = document.querySelector("#categoria-id").value;
  const datos = datosDe(formularioCategoria);
  try {
    if (id) {
      await put(`/api/categories/${id}`, datos);
      toast("Categoría actualizada.");
    } else {
      await post("/api/categories", datos);
      toast("Categoría creada.");
    }
    dialogoCategoria.close();
    await cargarOpciones();
    await cargar();
  } catch (error) {
    errorCategoria.textContent = textoError(error);
    errorCategoria.hidden = false;
  }
});

const botonCategorias = document.querySelector("#gestionar-categorias");
botonCategorias.addEventListener("click", async () => {
  const elegir = window.prompt(
    "Categorías actuales:\n" +
      categorias.map((categoria, indice) => `${indice + 1}) ${categoria.name} (${categoria.tareas} tareas)`).join("\n") +
      "\n\nEscribe el número para editar, o 'n' para crear una nueva."
  );
  if (!elegir) {
    return;
  }
  if (elegir.toLowerCase() === "n") {
    abrirEditorCategoria(null);
    return;
  }
  const indice = Number.parseInt(elegir, 10) - 1;
  if (categorias[indice]) {
    abrirEditorCategoria(categorias[indice]);
  }
});
document.querySelector("#close-categoria-dialog").addEventListener("click", () => dialogoCategoria.close());
document.querySelector("#cancel-categoria-dialog").addEventListener("click", () => dialogoCategoria.close());

/* ---------------- Filtros ---------------- */

let temporizador = null;
document.querySelector("#buscar").addEventListener("input", (evento) => {
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => {
    filtros.q = evento.target.value.trim();
    void cargar();
  }, 250);
});

document.querySelector("#filtro-estado").addEventListener("change", (evento) => {
  filtros.estado = evento.target.value;
  void cargar();
});

document.querySelector("#filtro-categoria").addEventListener("change", (evento) => {
  filtros.categoryId = evento.target.value;
  void cargar();
});

document.querySelector("#recargar").addEventListener("click", () => void cargar());

/* ---------------- Arranque ---------------- */

try {
  await cargarOpciones();
} catch (error) {
  toast(textoError(error), true);
}
await cargar();
