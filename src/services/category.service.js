import { prisma } from "../config/database.js";
import { conflicto, noEncontrado } from "../utils/http.js";

/** Listado con el número de tareas de cada categoría. */
export async function listarCategorias() {
  return prisma.category.findMany({
    include: { _count: { select: { tasks: true } } },
    orderBy: { name: "asc" }
  });
}

export async function obtenerCategoria(id) {
  const categoria = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { tasks: true } } }
  });
  if (!categoria) {
    throw noEncontrado("La categoría no existe.");
  }
  return categoria;
}

export async function crearCategoria({ name, description }) {
  const existente = await prisma.category.findUnique({ where: { name } });
  if (existente) {
    throw conflicto("Ya existe una categoría con ese nombre.");
  }
  return prisma.category.create({ data: { name, description } });
}

export async function actualizarCategoria(id, { name, description }) {
  await obtenerCategoria(id);
  const otra = await prisma.category.findUnique({ where: { name } });
  if (otra && otra.id !== id) {
    throw conflicto("Ya existe una categoría con ese nombre.");
  }
  return prisma.category.update({ where: { id }, data: { name, description } });
}

/**
 * Borrar una categoría deja sus tareas sin clasificar (ON DELETE SET NULL en el
 * esquema). No se borra la tarea: la tarea es "qué hay que hacer" y no depende
 * de cómo se etiquetara.
 */
export async function eliminarCategoria(id) {
  await obtenerCategoria(id);
  return prisma.category.delete({ where: { id } });
}
