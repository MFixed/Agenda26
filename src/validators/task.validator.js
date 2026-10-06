import {
  anotar,
  cuerpoObjeto,
  fechaISOoLista,
  horaValida,
  idPositivo,
  lanzarSiHayErrores,
  opcional,
  soloCampos,
  texto
} from "./helpers.js";

const ESTADOS = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const CAMPOS = new Set([
  "title",
  "description",
  "categoryId",
  "clientId",
  "dueDate",
  "dueTime",
  "status"
]);

function validarTitulo(lista, valor) {
  const title = texto(valor);
  if (title.length < 3 || title.length > 160) {
    anotar(lista, "title", "El título debe tener entre 3 y 160 caracteres.");
  }
  return title;
}

function validarDescripcion(lista, valor) {
  const description = opcional(valor);
  if (description && description.length > 2000) {
    anotar(lista, "description", "La descripción es demasiado larga (2000 caracteres).");
  }
  return description;
}

function validarEstado(lista, valor) {
  if (valor === undefined || valor === null || valor === "") {
    return undefined;
  }
  const status = texto(valor).toUpperCase();
  if (!ESTADOS.includes(status)) {
    anotar(lista, "status", `Usa uno de estos estados: ${ESTADOS.join(", ")}.`);
    return undefined;
  }
  return status;
}

function validarId(lista, campo, valor) {
  if (valor === undefined || valor === null || valor === "") {
    return null;
  }
  const id = idPositivo(valor);
  if (!id) {
    anotar(lista, campo, "Identificador no válido.");
    return null;
  }
  return id;
}

/**
 * POST /api/tasks y PUT /api/tasks/:id.
 *
 * dueDate puede venir vacío: eso significa "tarea sin fecha" y se guarda como
 * NULL. Nunca se inventa una fecha.
 */
export function parseTarea(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, CAMPOS, lista);

  const title = validarTitulo(lista, datos.title);
  const description = validarDescripcion(lista, datos.description);
  const categoryId = validarId(lista, "categoryId", datos.categoryId);
  const clientId = validarId(lista, "clientId", datos.clientId);
  const status = validarEstado(lista, datos.status);

  // dueDate explícitamente a null/"" -> tarea sin fecha. Ausente -> sin tocar.
  const dueDate =
    datos.dueDate === undefined ? undefined : fechaISOoLista(lista, "dueDate", datos.dueDate);
  const dueTime =
    datos.dueTime === undefined ? undefined : horaValida(lista, "dueTime", datos.dueTime);

  if (dueDate && dueTime === undefined) {
    // Sin regla extra: una tarea puede tener fecha sin hora, y hora sin fecha no
    // tiene sentido, así que se avisa.
    anotar(lista, "dueTime", "Indica la hora de la tarea.");
  }

  lanzarSiHayErrores(lista, "Revisa los datos de la tarea.");
  return { title, description, categoryId, clientId, dueDate, dueTime, status };
}

export { ESTADOS as ESTADOS_TAREA };
