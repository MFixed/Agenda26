import { randomBytes } from "node:crypto";
import { enTransaccion, prisma } from "../config/database.js";
import { conflicto, noAutorizado, noEncontrado, prohibido } from "../utils/http.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { aMedianocheUTC } from "../utils/date.js";

/** Contraseña temporal para los clientes que crea el administrador. */
function passwordTemporal() {
  return randomBytes(9).toString("base64url");
}

/**
 * Listado con búsqueda por nombre, documento, teléfono o correo.
 *
 * `mode: "insensitive"` lo traduce a ILIKE, que ignora mayúsculas y acentos.
 * OJO: Prisma sólo acepta ese argumento en PostgreSQL y MongoDB. Con el
 * conector de SQLite lanza `Unknown argument 'mode'` y la búsqueda entera
 * revienta, y no es un fallo que se viera: con SQLite estaba rota desde el
 * principio y no lo probaba ninguna prueba. Hay una ahora, en api.test.js.
 */
export async function listarClientes({ q, limit, offset }, businessId) {
  const where = {
    businessId,
    ...(q ? { OR: condicionesDeBusqueda(q) } : {})
  };

  const [total, clientes] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, activo: true, ultimoAcceso: true } },
        _count: { select: { appointments: true, tasks: true } }
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset
    })
  ]);

  return {
    total,
    items: clientes.map((cliente) => ({
      ...cliente,
      citas: cliente._count.appointments,
      tareas: cliente._count.tasks
    }))
  };
}

function condicionesDeBusqueda(q) {
  const sinDistincion = { contains: q, mode: "insensitive" };
  return [
    { nombre: sinDistincion },
    { documento: sinDistincion },
    { telefono: sinDistincion },
    { user: { email: sinDistincion } }
  ];
}

export async function obtenerCliente(id, businessId = null) {
  const cliente = await prisma.client.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, nombre: true, email: true, activo: true, ultimoAcceso: true } },
      _count: { select: { appointments: true, tasks: true } }
    }
  });
  if (!cliente || (businessId !== null && cliente.businessId !== businessId)) {
    throw noEncontrado("El cliente no existe.");
  }
  return cliente;
}

export async function obtenerClientePorUsuario(userId) {
  return prisma.client.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, nombre: true, email: true, activo: true } },
      _count: { select: { appointments: true, tasks: true } }
    }
  });
}

/** Alta manual desde el panel. Sin contraseña se genera una temporal. */
export async function crearCliente(datos, businessId) {
  const existe = await prisma.user.findUnique({ where: { email: datos.email }, select: { id: true } });
  if (existe) {
    throw conflicto("Ya existe una cuenta con ese correo electrónico.");
  }
  if (datos.documento) {
    const conDocumento = await prisma.client.findUnique({
      where: { businessId_documento: { businessId, documento: datos.documento } },
      select: { id: true }
    });
    if (conDocumento) {
      throw conflicto("Ya existe un cliente con ese documento en este negocio.");
    }
  }

  const password = datos.password || passwordTemporal();
  const usuario = await prisma.user.create({
    data: {
      nombre: datos.nombre,
      email: datos.email,
      passwordHash: await hashPassword(password),
      role: "CLIENT",
      businessId,
      client: {
        create: {
          businessId,
          nombre: datos.nombre,
          documento: datos.documento,
          fechaNacimiento: aMedianocheUTC(datos.fechaNacimiento),
          telefono: datos.telefono,
          direccion: datos.direccion
        }
      }
    },
    include: { client: true }
  });

  return { cliente: usuario.client, passwordTemporal: datos.password ? null : password };
}

export async function actualizarCliente(id, cambios, businessId) {
  const cliente = await obtenerCliente(id, businessId);

  if (cambios.email && cambios.email !== cliente.user.email) {
    const conEmail = await prisma.user.findUnique({
      where: { email: cambios.email },
      select: { id: true }
    });
    if (conEmail) {
      throw conflicto("Ese correo electrónico ya está en uso.");
    }
  }
  if (cambios.documento && cambios.documento !== cliente.documento) {
    const conDocumento = await prisma.client.findUnique({
      where: { businessId_documento: { businessId, documento: cambios.documento } },
      select: { id: true }
    });
    if (conDocumento) {
      throw conflicto("Ese documento ya está registrado en este negocio.");
    }
  }
  if (cambios.activo === false && cliente.user.activo) {
    const otrosActivos = await prisma.user.count({ where: { role: "ADMIN", activo: true, businessId } });
    if (otrosActivos === 0) {
      throw conflicto("No puedes desactivar la última cuenta de administración.");
    }
  }

  const clienteActualizado = await prisma.client.update({
    where: { id },
    data: {
      nombre: cambios.nombre,
      documento: cambios.documento,
      fechaNacimiento:
        cambios.fechaNacimiento === undefined ? undefined : aMedianocheUTC(cambios.fechaNacimiento),
      telefono: cambios.telefono,
      direccion: cambios.direccion
    }
  });

  await prisma.user.update({
    where: { id: cliente.userId },
    data: {
      nombre: cambios.nombre,
      email: cambios.email,
      activo: cambios.activo,
      ...(cambios.password ? { passwordHash: await hashPassword(cambios.password) } : {})
    }
  });

  return obtenerCliente(clienteActualizado.id, businessId);
}

/** El cliente cambia su propia contraseña desde la pantalla de perfil. */
export async function cambiarPasswordPropia(usuario, { passwordActual, passwordNueva }) {
  const correcta = await verifyPassword(passwordActual, usuario.passwordHash);
  if (!correcta) {
    throw noAutorizado("La contraseña actual no es correcta.");
  }
  await prisma.user.update({
    where: { id: usuario.id },
    data: { passwordHash: await hashPassword(passwordNueva) }
  });
}

/**
 * El cliente actualiza su propia ficha. Se comprueba que el documento no lo
 * tenga otro cliente, y el email no lo tenga otra cuenta.
 */
export async function actualizarPerfilPropio(userId, cambios) {
  const cliente = await obtenerClientePorUsuario(userId);
  if (!cliente) {
    throw noEncontrado("Tu perfil de cliente no existe.");
  }

  if (cambios.email && cambios.email !== cliente.user.email) {
    const conEmail = await prisma.user.findUnique({
      where: { email: cambios.email },
      select: { id: true }
    });
    if (conEmail) {
      throw conflicto("Ese correo electrónico ya está en uso.");
    }
  }
  if (cambios.documento && cambios.documento !== cliente.documento) {
    const conDocumento = await prisma.client.findUnique({
      where: { businessId_documento: { businessId: cliente.businessId, documento: cambios.documento } },
      select: { id: true }
    });
    if (conDocumento) {
      throw conflicto("Ese documento ya está registrado.");
    }
  }

  await prisma.client.update({
    where: { id: cliente.id },
    data: {
      nombre: cambios.nombre,
      documento: cambios.documento,
      fechaNacimiento:
        cambios.fechaNacimiento === undefined ? undefined : aMedianocheUTC(cambios.fechaNacimiento),
      telefono: cambios.telefono,
      direccion: cambios.direccion
    }
  });

  await prisma.user.update({
    where: { id: userId },
    data: { nombre: cambios.nombre, email: cambios.email }
  });

  return obtenerCliente(cliente.id);
}

/** El cliente no puede tocar su propio estado ni su rol. */
export function exigirNoEsAdmin(usuario) {
  if (usuario.role === "ADMIN") {
    throw prohibido("Los administradores no tienen perfil de cliente.");
  }
}

/**
 * Borra un cliente y su usuario. El admin no puede borrarse a sí mismo y no se
 * puede dejar la aplicación sin ningún administrador activo.
 *
 * OJO CON LAS TAREAS
 * Al borrar el usuario cae en cascada el cliente, y con él sus citas. Pero
 * Task.clientId está en SetNull, así que las tareas NO se borran: quedan
 * huérfanas, sin cliente y sin cita, y el administrador las ve aparecer en
 * "Mis tareas" sin saber de dónde salieron. Cada cliente eliminado plantaba una
 * bolsa de tareas zombis en su lista de trabajo.
 *
 * Aquí se limpian las que nacieron de sus citas. Las que el administrador creó a
 * mano y le asignó se conservan: son trabajo suyo, no de las citas, y borrar una
 * tarea que nadie pidió borrar sería peor que el problema que se arregla.
 */
export async function eliminarCliente(id, usuarioActual) {
  const cliente = await obtenerCliente(id, usuarioActual.businessId);
  if (cliente.userId === usuarioActual.id) {
    throw conflicto("No puedes eliminar tu propia cuenta.");
  }
  if (cliente.user.activo && (await contarAdminsActivos(cliente.businessId)) === 0) {
    throw conflicto("No puedes eliminar la última cuenta de administración.");
  }

  return enTransaccion(async (tx) => {
    // Se recogen antes de borrar, porque después ya no hay citas que mirar.
    const citas = await tx.appointment.findMany({ where: { clientId: id }, select: { taskId: true } });
    const tareasDeSusCitas = [...new Set(citas.map((cita) => cita.taskId))];

    await tx.user.delete({ where: { id: cliente.userId } });

    // Para entonces las citas ya no existen, así que "sin citas" selecciona
    // exactamente las tareas que se han quedado sueltas.
    if (tareasDeSusCitas.length > 0) {
      await tx.task.deleteMany({
        where: { id: { in: tareasDeSusCitas }, appointments: { none: {} } }
      });
    }

    return cliente;
  });
}

async function contarAdminsActivos(businessId) {
  return prisma.user.count({ where: { role: "ADMIN", activo: true, businessId } });
}
