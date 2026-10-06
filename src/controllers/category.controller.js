import { categoriaPublica } from "../utils/serialize.js";
import * as categoryService from "../services/category.service.js";
import { parseCategoria } from "../validators/category.validator.js";

/** GET /api/categories — la lectura es común: el cliente elige la de su servicio. */
export async function listar(request, response) {
  const categorias = await categoryService.listarCategorias(request.user.businessId);
  response.json({ items: categorias.map((categoria) => categoriaPublica(categoria, { conConteo: true })) });
}

export async function obtener(request, response) {
  const categoria = await categoryService.obtenerCategoria(request.id, request.user.businessId);
  response.json({ categoria: categoriaPublica(categoria, { conConteo: true }) });
}

export async function crear(request, response) {
  const datos = parseCategoria(request.body);
  const categoria = await categoryService.crearCategoria(datos, request.user.businessId);
  response.status(201).json({ categoria: categoriaPublica(categoria), mensaje: "Categoría creada." });
}

export async function actualizar(request, response) {
  const datos = parseCategoria(request.body);
  const categoria = await categoryService.actualizarCategoria(request.id, datos, request.user.businessId);
  response.json({ categoria: categoriaPublica(categoria), mensaje: "Categoría actualizada." });
}

export async function eliminar(request, response) {
  await categoryService.eliminarCategoria(request.id, request.user.businessId);
  response.json({ ok: true, mensaje: "Categoría eliminada. Sus tareas quedan sin clasificar." });
}
