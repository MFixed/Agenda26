import { anotar, cuerpoObjeto, lanzarSiHayErrores, opcional, soloCampos, texto } from "./helpers.js";

const CAMPOS = new Set(["name", "description"]);

function validarNombre(lista, valor) {
  const name = texto(valor);
  if (name.length < 2 || name.length > 40) {
    anotar(lista, "name", "El nombre debe tener entre 2 y 40 caracteres.");
  }
  return name.toUpperCase();
}

function validarDescripcion(lista, valor) {
  const description = opcional(valor);
  if (description && description.length > 240) {
    anotar(lista, "description", "La descripción es demasiado larga (240 caracteres).");
  }
  return description;
}

export function parseCategoria(cuerpo) {
  const datos = cuerpoObjeto(cuerpo);
  const lista = [];
  soloCampos(datos, CAMPOS, lista);

  const name = validarNombre(lista, datos.name);
  const description = validarDescripcion(lista, datos.description);

  lanzarSiHayErrores(lista, "Revisa los datos de la categoría.");
  return { name, description };
}
