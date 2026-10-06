import { prisma } from "../config/database.js";
import { conflicto, noEncontrado } from "../utils/http.js";

/** Listado con el número de tareas de cada categoría. */
export async function listarCategorias(businessId) {
  return prisma.category.findMany({
    where: { businessId },
    include: { _count: { select: { tasks: true } } },
    orderBy: { name: "asc" }
  });
}

export async function obtenerCategoria(id, businessId = null) {
  const categoria = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { tasks: true } } }
  });
  if (!categoria || (businessId !== null && categoria.businessId !== businessId)) {
    throw noEncontrado("La categoría no existe.");
  }
  return categoria;
}

export async function crearCategoria({ name, description }, businessId) {
  const existente = await prisma.category.findUnique({
    where: { businessId_name: { businessId, name } }
  });
  if (existente) {
    throw conflicto("Ya existe una categoría con ese nombre.");
  }
  return prisma.category.create({ data: { name, description, businessId } });
}

export async function actualizarCategoria(id, { name, description }, businessId) {
  const actual = await obtenerCategoria(id, businessId);
  const otra = await prisma.category.findUnique({
    where: { businessId_name: { businessId, name } }
  });
  if (otra && otra.id !== id) {
    throw conflicto("Ya existe una categoría con ese nombre.");
  }
  return prisma.category.update({ where: { id: actual.id }, data: { name, description } });
}

/**
 * Borrar una categoría deja sus tareas sin clasificar (ON DELETE SET NULL en el
 * esquema). No se borra la tarea: la tarea es "qué hay que hacer" y no depende
 * de cómo se etiquetara.
 */
export async function eliminarCategoria(id, businessId) {
  const actual = await obtenerCategoria(id, businessId);
  return prisma.category.delete({ where: { id: actual.id } });
}
