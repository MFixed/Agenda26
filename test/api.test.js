import test from "node:test";
import assert from "node:assert/strict";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/config/database.js";

/**
 * Pruebas de la capa HTTP: que el middleware de autorización haga su trabajo y
 * que un cliente no llegue a datos de otro cambiando un id en la URL (reglas 8,
 * 9, 10 y 12).
 *
 *   npm test
 */

const app = crearApp();
const servidor = app.listen(0);
const { port } = servidor.address();

const base = `http://127.0.0.1:${port}`;

async function pedir(ruta, { metodo = "GET", cuerpo, token } = {}) {
  const cabeceras = {};
  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";
  if (token) cabeceras.Authorization = `Bearer ${token}`;

  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });

  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = JSON.parse(texto);
  } catch {
    datos = texto;
  }
  return { estado: respuesta.status, datos };
}

/** Accounts from the seed, which is deterministic. */
async function cuentas() {
  const admin = await prisma.user.findUnique({ where: { email: "admin@ejemplo.com" } });
  const ana = await prisma.user.findUnique({ where: { email: "ana@ejemplo.com" }, include: { client: true } });
  const luis = await prisma.user.findUnique({ where: { email: "luis@ejemplo.com" }, include: { client: true } });
  const superadmin = await prisma.user.findFirst({ where: { role: "SUPERADMIN" } });
  return { admin, ana, luis, superadmin };
}

let tokens = {};

test.before(async () => {
  const { admin, ana, luis, superadmin } = await cuentas();
  const entradaAdmin = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: admin.email, password: "Admin1234", negocio: "principal" }
  });
  const entradaAna = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: ana.email, password: "Cliente1234", negocio: "principal" }
  });
  const entradaLuis = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: luis.email, password: "Cliente1234", negocio: "principal" }
  });
  // El superadmin entra por /login, sin negocio: es el único que puede.
  const entradaSuper = superadmin
    ? await pedir("/api/auth/login", {
        metodo: "POST",
        cuerpo: { email: superadmin.email, password: "Super1234" }
      })
    : { datos: { token: null } };

  tokens = {
    admin: entradaAdmin.datos.token,
    ana: entradaAna.datos.token,
    luis: entradaLuis.datos.token,
    super: entradaSuper.datos.token
  };
});

test.after(async () => {
  await new Promise((resolver) => servidor.close(resolver));
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ *
 * Autenticación
 * ------------------------------------------------------------------ */

test("sin token no se entra", async () => {
  const { estado } = await pedir("/api/appointments");
  assert.equal(estado, 401);
});

test("un token inventado se rechaza", async () => {
  const { estado } = await pedir("/api/appointments", { token: "abc.def.ghi" });
  assert.equal(estado, 401);
});

test("el login del seed funciona para admin y para cliente", async () => {
  const { admin, ana } = await cuentas();
  const adminLogin = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: admin.email, password: "Admin1234", negocio: "principal" }
  });
  assert.equal(adminLogin.estado, 200);
  assert.equal(adminLogin.datos.user.role, "ADMIN");
  assert.equal(adminLogin.datos.user.passwordHash, undefined, "nunca debe viajar el hash");

  const clienteLogin = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: ana.email, password: "Cliente1234", negocio: "principal" }
  });
  assert.equal(clienteLogin.estado, 200);
  assert.equal(clienteLogin.datos.user.role, "CLIENT");
  assert.equal(clienteLogin.datos.client.documento, "12345678A");
});

test("una contraseña incorrecta no dice si el correo existe", async () => {
  const malPass = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: "ana@ejemplo.com", password: "Incorrecta999", negocio: "principal" }
  });
  const inexistente = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: "nadie@ejemplo.com", password: "Incorrecta999", negocio: "principal" }
  });

  assert.equal(malPass.estado, 401);
  assert.equal(inexistente.estado, 401);
  assert.equal(malPass.datos.error, inexistente.datos.error, "el mensaje debe ser idéntico");
});

test("el registro público no acepta un rol", async () => {
  const { estado } = await pedir("/api/auth/register", {
    metodo: "POST",
    cuerpo: {
      nombre: "Intruso Malicioso",
      email: `intruso.${Date.now()}@ejemplo.com`,
      password: "Pruebas1234",
      confirmPassword: "Pruebas1234",
      documento: `X${Date.now()}`,
      fechaNacimiento: "1990-01-01",
      negocio: "principal",
      role: "ADMIN"
    }
  });
  assert.equal(estado, 422, "el campo role no está permitido en el registro");
});

/* ------------------------------------------------------------------ *
 * Separación de roles (§19)
 * ------------------------------------------------------------------ */

test("un cliente no entra en las rutas de administración", async () => {
  const rutas = [
    ["GET", "/api/clients"],
    ["GET", "/api/tasks"],
    ["POST", "/api/categories", { name: "INTRUSO", description: null }],
    ["POST", "/api/availability", { date: "2030-01-01", startTime: "10:00", endTime: "11:00" }]
  ];

  for (const [metodo, ruta, cuerpo] of rutas) {
    const { estado } = await pedir(ruta, { metodo, cuerpo, token: tokens.ana });
    assert.equal(estado, 403, `${metodo} ${ruta} debería ser 403 para un cliente`);
  }
});

test("el administrador sí entra", async () => {
  const clientes = await pedir("/api/clients", { token: tokens.admin });
  assert.equal(clientes.estado, 200);
  assert.ok(clientes.datos.total >= 2);

  const tareas = await pedir("/api/tasks", { token: tokens.admin });
  assert.equal(tareas.estado, 200);
});

test("un cliente no puede crear disponibilidad ni.categories por URL manipulada", async () => {
  const categorias = await pedir("/api/categories", { token: tokens.ana });
  assert.equal(categorias.estado, 200, "leer categorías sí se permite");

  const crear = await pedir("/api/categories", {
    metodo: "POST",
    cuerpo: { name: "INTRUSA" },
    token: tokens.ana
  });
  assert.equal(crear.estado, 403);
});

/* ------------------------------------------------------------------ *
 * Aislamiento entre clientes (regla 8 y 12)
 * ------------------------------------------------------------------ */

test("un cliente sólo ve sus propias citas", async () => {
  const { ana, luis } = await cuentas();

  const citasAna = await pedir("/api/appointments", { token: tokens.ana });
  assert.equal(citasAna.estado, 200);
  assert.ok(
    citasAna.datos.items.every((cita) => cita.clientId === ana.client.id),
    "todas las citas deben ser suyas"
  );

  const citasLuis = await pedir("/api/appointments", { token: tokens.luis });
  assert.ok(citasLuis.datos.items.every((cita) => cita.clientId === luis.client.id));
});

test("un cliente no puede abrir la cita de otro cambiando el id", async () => {
  const { luis } = await cuentas();
  // La cita la crea la propia prueba sobre un hueco libre, en vez de confiar en
  // lo que dejó el seed: así sigue valiendo aunque la base tenga otros datos.
  const citaDeLuis = await crearCitaPara(tokens.admin, luis.client.id);

  const { estado } = await pedir(`/api/appointments/${citaDeLuis.id}`, { token: tokens.ana });
  assert.equal(estado, 403);

  // Tampoco puede borrarla ni cambiar su estado.
  const borrar = await pedir(`/api/appointments/${citaDeLuis.id}`, {
    metodo: "DELETE",
    token: tokens.ana
  });
  assert.equal(borrar.estado, 403);

  const coordinar = await pedir(`/api/appointments/${citaDeLuis.id}/coordinar`, {
    metodo: "POST",
    token: tokens.ana
  });
  assert.equal(coordinar.estado, 403);

  // Limpieza: la cita, la tarea que nació con ella y el hueco que la prueba ha
  // creado. Sin esto la base se queda con una tarea suelta por cada ejecución.
  await pedir(`/api/appointments/${citaDeLuis.id}`, { metodo: "DELETE", token: tokens.admin });
  await prisma.task.deleteMany({
    where: { id: citaDeLuis.taskId, appointments: { none: {} } }
  });
  await pedir(`/api/availability/${citaDeLuis.availabilityId}`, {
    metodo: "DELETE",
    token: tokens.admin
  });
});

/** Publica un hueco libre y lo reserva para el cliente indicado, como el admin. */
async function crearCitaPara(tokenAdmin, clientId) {
  const hoy = new Date().toISOString().slice(0, 10);
  const { datos: listados } = await pedir(
    `/api/availability?estado=AVAILABLE&desde=${hoy}`,
    { token: tokenAdmin }
  );

  let hueco = listados.items[0];
  if (!hueco) {
    hueco = await publicarHuecoLibre(tokenAdmin, hoy);
  }
  const respuesta = await pedir("/api/appointments", {
    metodo: "POST",
    token: tokenAdmin,
    cuerpo: { clientId, availabilityId: hueco.id, note: "Cita de prueba de aislamiento." }
  });
  assert.equal(respuesta.estado, 201, respuesta.datos?.error);
  return { ...respuesta.datos.cita, availabilityId: hueco.id };
}

/**
 * Publica un hueco en una fecha lejana probando horas hasta que una salga. La
 * base puede venir llena de pruebas anteriores, así que no se fija una hora.
 */
async function publicarHuecoLibre(tokenAdmin, desde) {
  const fecha = new Date(desde);
  fecha.setDate(fecha.getDate() + 400);

  for (let hora = 8; hora <= 20; hora += 1) {
    const respuesta = await pedir("/api/availability", {
      metodo: "POST",
      token: tokenAdmin,
      cuerpo: {
        date: fecha.toISOString().slice(0, 10),
        startTime: `${String(hora).padStart(2, "0")}:00`,
        endTime: `${String(hora + 1).padStart(2, "0")}:00`,
        status: "AVAILABLE"
      }
    });
    if (respuesta.estado === 201) {
      return respuesta.datos.disponibilidad;
    }
  }

  assert.fail("No se pudo publicar ningún hueco libre para la prueba.");
}

/**
 * Búsqueda de clientes.
 *
 * Estas pruebas existen porque la búsqueda estaba rota y no se notaba: el código
 * usaba `mode: "insensitive"`, que Prisma sólo acepta en PostgreSQL. Con el
 * conector de SQLite la consulta lanzaba "Unknown argument 'mode'" y el listado
 * entero devolvía 500. Nadie la probó porque no había ninguna prueba de búsqueda.
 */
test("la búsqueda de clientes encuentra por nombre sin distinguir mayúsculas", async () => {
  const { ana } = await cuentas();

  // En minúsculas, contra un nombre que en la ficha está en mayúsculas.
  const minusculas = ana.client.nombre.toLowerCase();
  const { estado, datos } = await pedir(`/api/clients?q=${encodeURIComponent(minusculas)}`, {
    token: tokens.admin
  });

  assert.equal(estado, 200, "la búsqueda no debe devolver un error");
  assert.ok(Array.isArray(datos.items), "debe devolver un listado");
  assert.ok(
    datos.items.some((c) => c.id === ana.client.id),
    `debe encontrar a ${ana.client.nombre} buscando "${minusculas}"`
  );
});

test("la búsqueda de clientes encuentra por correo", async () => {
  const { ana } = await cuentas();

  const { estado, datos } = await pedir(`/api/clients?q=${encodeURIComponent(ana.email)}`, {
    token: tokens.admin
  });

  assert.equal(estado, 200);
  assert.ok(
    datos.items.some((c) => c.id === ana.client.id),
    "debe encontrar por correo electrónico"
  );
});

test("una búsqueda que no encuentra nada devuelve una lista vacía, no un error", async () => {
  const { estado, datos } = await pedir("/api/clients?q=noexistenadaprimeracosa", { token: tokens.admin });

  assert.equal(estado, 200);
  assert.deepEqual(datos.items, [], "sin resultados es una lista vacía");
  assert.equal(datos.total, 0);
});

test("un cliente no puede ver la ficha de otro cliente", async () => {
  const { luis } = await cuentas();
  const { estado } = await pedir(`/api/clients/${luis.client.id}`, { token: tokens.ana });
  assert.equal(estado, 403);
});

test("un cliente no puede ver las notificaciones de otro", async () => {
  const { ana, luis } = await cuentas();

  const suyas = await pedir("/api/notifications", { token: tokens.ana });
  assert.equal(suyas.estado, 200);
  assert.ok(suyas.datos.items.every((n) => n.userId === ana.id));

  // Marcar como leída la notificación de Luis con el token de Ana no funciona.
  const notificacionLuis = await prisma.notification.findFirst({ where: { userId: luis.id } });
  if (notificacionLuis) {
    const { estado } = await pedir(`/api/notifications/${notificacionLuis.id}/read`, {
      metodo: "PUT",
      token: tokens.ana
    });
    assert.equal(estado, 404, "no debe encontrar la notificación de otro usuario");
  }
});

test("marcar una notificación propia como leída la deja con readAt", async () => {
  // Es el botón de la campana; si el serializer se rompe por el camino salía un
  // 500, así que se comprueba el cuerpo entero, no sólo el estado.
  const propia = await prisma.notification.findFirst({
    where: { userId: (await cuentas()).ana.id, readAt: null }
  });
  if (!propia) {
    return; // el seed no dejó ninguna sin leer
  }

  const { estado, datos } = await pedir(`/api/notifications/${propia.id}/read`, {
    metodo: "PUT",
    token: tokens.ana
  });
  assert.equal(estado, 200);
  assert.equal(datos.notificacion.id, propia.id);
  assert.equal(datos.notificacion.leida, true);
  assert.ok(datos.notificacion.readAt, "debe traer la fecha de lectura");
});

test("marcar todas como leídas vacía el contador", async () => {
  const { ana } = await cuentas();
  await pedir("/api/notifications/read-all", { metodo: "PUT", token: tokens.ana });

  const despues = await pedir("/api/notifications", { token: tokens.ana });
  assert.equal(despues.datos.noLeidas, 0);
  assert.ok(despues.datos.items.every((n) => n.leida === true));
  void ana;
});

/* ------------------------------------------------------------------ *
 * Perfil
 * ------------------------------------------------------------------ */

test("cada cliente ve y edita su propio perfil", async () => {
  const mio = await pedir("/api/clients/me", { token: tokens.ana });
  assert.equal(mio.estado, 200);
  assert.equal(mio.datos.cliente.documento, "12345678A");
  // El email vive en la cuenta, no en la ficha: la ficha sólo lleva el userId.
  const { ana } = await cuentas();
  assert.equal(mio.datos.cliente.userId, ana.id);
  assert.equal(mio.datos.cliente.email, undefined);
  assert.equal(mio.datos.cliente.passwordHash, undefined);

  const cambiado = await pedir("/api/clients/me", {
    metodo: "PUT",
    token: tokens.ana,
    cuerpo: {
      nombre: "Ana Martínez Ruiz",
      email: "ana@ejemplo.com",
      documento: "12345678A",
      fechaNacimiento: "1994-05-17",
      telefono: "+34 600 999 888",
      direccion: "Calle Mayor 1, 3º B, 28013 Madrid"
    }
  });
  assert.equal(cambiado.estado, 200);
  assert.equal(cambiado.datos.cliente.telefono, "+34 600 999 888");
});

test("el perfil propio no acepta cambiar el estado ni el rol", async () => {
  const { estado } = await pedir("/api/clients/me", {
    metodo: "PUT",
    token: tokens.ana,
    cuerpo: {
      nombre: "Ana Martínez Ruiz",
      email: "ana@ejemplo.com",
      documento: "12345678A",
      fechaNacimiento: "1994-05-17",
      activo: false
    }
  });
  assert.equal(estado, 422);
});

/* ------------------------------------------------------------------ *
 * Validación de entrada (§23)
 * ------------------------------------------------------------------ */

test("los ids no numéricos se rechazan antes de tocar la base de datos", async () => {
  for (const ruta of ["/api/clients/abc", "/api/tasks/abc", "/api/appointments/abc"]) {
    const { estado } = await pedir(ruta, { token: tokens.admin });
    assert.ok(estado === 422 || estado === 404, `${ruta} devolvió ${estado}`);
  }
});

test("una cita necesita los tres elementos: tarea, cliente y disponibilidad", async () => {
  const { ana } = await cuentas();
  const { estado, datos } = await pedir("/api/appointments", {
    metodo: "POST",
    token: tokens.ana,
    cuerpo: { note: "Sin horario elegido" }
  });
  assert.equal(estado, 422);
  assert.ok(
    datos.details.some((detalle) => detalle.field === "availabilityId"),
    "debe avisar de que falta el horario"
  );
});

test("el JSON mal formado da 400 y no revienta el servidor", async () => {
  const respuesta = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{esto no es json"
  });
  assert.equal(respuesta.status, 400);
});

test("un cuerpo que no es un objeto se rechaza", async () => {
  const respuesta = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(["email", "password"])
  });
  assert.equal(respuesta.status, 422);
});

/* ------------------------------------------------------------------ *
 * Rutas inexistentes
 * ------------------------------------------------------------------ */

test("una ruta de API inexistente responde JSON 404", async () => {
  const respuesta = await fetch(`${base}/api/no-existe`);
  assert.equal(respuesta.status, 404);
  assert.equal(respuesta.headers.get("content-type")?.includes("application/json"), true);
});

test("las páginas se sirven sin token (el rol se comprueba en el navegador)", async () => {
  for (const pagina of ["/login", "/registro", "/cliente", "/admin"]) {
    const respuesta = await fetch(`${base}${pagina}`);
    assert.equal(respuesta.status, 200, `${pagina} debería servir`);
  }
});

/* ------------------------------------------------------------------ *
 * Multi-negocio: el superadministrador y las puertas de cada empresa
 *
 * Estas pruebas van por HTTP porque el aislamiento no está sólo en los
 * servicios: depende de que authenticate saque el businessId del token y de que
 * las rutas del superadmin Rechacen a cualquiera que no sea él.
 * ------------------------------------------------------------------ */

test("el superadministrador entra sin negocio, y sólo él", async () => {
  const { superadmin } = await cuentas();
  assert.ok(superadmin, "el seed debe dejar un superadministrador (npm run db:seed)");

  const { estado, datos } = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: superadmin.email, password: "Super1234" }
  });
  assert.equal(estado, 200);
  assert.equal(datos.user.role, "SUPERADMIN");
  // "negocio" va junto a "user", no dentro: para el superadmin es null porque no
  // pertenece a ninguno.
  assert.equal(datos.negocio, null, "no pertenece a ningún negocio");
  assert.equal(datos.user.businessId, null, "y el id de empresa también es null");

  // Si se le pasa un negocio en el login, se rechaza: su puerta es /login.
  const conNegocio = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: superadmin.email, password: "Super1234", negocio: "principal" }
  });
  assert.equal(conNegocio.estado, 401);
});

test("el superadministrador no entra en las rutas de una empresa", async () => {
  for (const ruta of ["/api/clients", "/api/tasks", "/api/categories", "/api/availability"]) {
    const { estado } = await pedir(ruta, { token: tokens.super });
    assert.equal(estado, 403, `${ruta} debería ser 403 para el superadmin`);
  }
});

test("sólo el superadministrador entra en el panel de negocios", async () => {
  for (const token of [tokens.admin, tokens.ana, tokens.luis]) {
    const listar = await pedir("/api/super/negocios", { token });
    assert.equal(listar.estado, 403, "un usuario de empresa no lista negocios");

    const crear = await pedir("/api/super/negocios", {
      metodo: "POST",
      cuerpo: {
        nombre: "Intruso",
        slug: `intruso-${Date.now()}`,
        adminNombre: "Intruso Malicioso",
        adminEmail: `intruso.${Date.now()}@ejemplo.com`,
        adminPassword: "Pruebas1234"
      },
      token
    });
    assert.equal(crear.estado, 403, "un usuario de empresa no crea negocios");
  }
});

test("el superadministrador crea una empresa y su administrador entra por su puerta", async () => {
  const marca = Date.now();
  const slug = `empresa-${marca}`;
  const emailAdmin = `dueño.${marca}@ejemplo.com`;

  const creado = await pedir("/api/super/negocios", {
    metodo: "POST",
    token: tokens.super,
    cuerpo: {
      nombre: `Empresa de pruebas ${marca}`,
      slug,
      descripcion: "Negocio creado por la prueba de HTTP.",
      adminNombre: "Dueño De La Empresa",
      adminEmail: emailAdmin,
      adminPassword: "Pruebas1234"
    }
  });
  assert.equal(creado.estado, 201, creado.datos?.error);
  const idNegocio = creado.datos.negocio.id;

  try {
    // El identificador es único: repetirlo choca.
    const repetido = await pedir("/api/super/negocios", {
      metodo: "POST",
      token: tokens.super,
      cuerpo: {
        nombre: "Otra empresa",
        slug,
        adminNombre: "Otro Dueño",
        adminEmail: `otro.${marca}@ejemplo.com`,
        adminPassword: "Pruebas1234"
      }
    });
    assert.equal(repetido.estado, 409);

    // El negocio aparece en el panel, con su contador a cero.
    const listado = await pedir("/api/super/negocios", { token: tokens.super });
    assert.equal(listado.estado, 200);
    const fila = listado.datos.items.find((n) => n.id === idNegocio);
    assert.ok(fila, "la empresa nueva debe salir en el panel");
    assert.equal(fila.usuarios, 1, "nace con un solo administrador");
    assert.equal(fila.administradores, 1, "y ese administrador está activo");
    assert.equal(fila.clientes, 0);
    assert.equal(fila.citas, 0);

    // Su administrador entra por la puerta de SU negocio...
    const entrada = await pedir("/api/auth/login", {
      metodo: "POST",
      cuerpo: { email: emailAdmin, password: "Pruebas1234", negocio: slug }
    });
    assert.equal(entrada.estado, 200, entrada.datos?.error);
    assert.equal(entrada.datos.user.role, "ADMIN");
    assert.equal(entrada.datos.negocio.slug, slug, "la sesión trae su empresa");

    // ...y por la de otro no.
    const otraPuerta = await pedir("/api/auth/login", {
      metodo: "POST",
      cuerpo: { email: emailAdmin, password: "Pruebas1234", negocio: "principal" }
    });
    assert.equal(otraPuerta.estado, 401);

    // La empresa nueva nace con sus categorías base y una lista de clientes vacía.
    const categorias = await pedir("/api/categories", { token: entrada.datos.token });
    assert.equal(categorias.estado, 200);
    assert.ok(categorias.datos.items.length > 0, "debe nacer con las categorías base");
    assert.ok(
      categorias.datos.items.some((categoria) => categoria.name === "SERVICIOS"),
      "y con SERVICIOS, que es la que usan las citas"
    );
    const clientes = await pedir("/api/clients", { token: entrada.datos.token });
    assert.equal(clientes.datos.total, 0, "una empresa nueva no tiene clientes");

    // Un cliente se registra en la empresa nueva y no aparece en la principal.
    const registro = await pedir("/api/auth/register", {
      metodo: "POST",
      cuerpo: {
        nombre: "Cliente De La Empresa Nueva",
        email: `cliente.${marca}@ejemplo.com`,
        password: "Pruebas1234",
        confirmPassword: "Pruebas1234",
        documento: `NEW${marca}`,
        fechaNacimiento: "1990-01-01",
        negocio: slug
      }
    });
    assert.equal(registro.estado, 201, registro.datos?.error);
    const idClienteNuevo = registro.datos.client.id;

    const clientesPrincipal = await pedir("/api/clients", { token: tokens.admin });
    assert.ok(
      !clientesPrincipal.datos.items.some((c) => c.id === idClienteNuevo),
      "el cliente de la empresa nueva no aparece en el listado de la principal"
    );

    // Y el administrador de la principal lo tiene el mismo día: cada empresa ve
    // únicamente los clientes que se han registrado en ella.
    const clientesNuevoAdmin = await pedir(`/api/clients?q=${encodeURIComponent(`cliente.${marca}@ejemplo.com`)}`, {
      token: entrada.datos.token
    });
    assert.equal(clientesNuevoAdmin.datos.total, 1);

    // Desactivar la empresa cierra sus puertas, también por API.
    const desactivado = await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: false }
    });
    assert.equal(desactivado.estado, 200);
    assert.equal(desactivado.datos.negocio.activo, false);

    const trasDesactivar = await pedir("/api/auth/login", {
      metodo: "POST",
      cuerpo: { email: emailAdmin, password: "Pruebas1234", negocio: slug }
    });
    assert.equal(trasDesactivar.estado, 403, "una empresa desactivada no deja entrar");
  } finally {
    // El borrado en cascada se lleva clientes, citas, tareas y horarios con él.
    await prisma.business.deleteMany({ where: { id: idNegocio } });
  }
});

test("no se puede dejar una empresa desactivada sin ningún administrador activo", async () => {
  const marca = Date.now();
  const slug = `sinadmin-${marca}`;
  const creado = await pedir("/api/super/negocios", {
    metodo: "POST",
    token: tokens.super,
    cuerpo: {
      nombre: "Empresa sin admins",
      slug,
      adminNombre: "Unico Administrador",
      adminEmail: `unico.${marca}@ejemplo.com`,
      adminPassword: "Pruebas1234"
    }
  });
  assert.equal(creado.estado, 201, creado.datos?.error);
  const idNegocio = creado.datos.negocio.id;

  try {
    // Con su administrador vivo, desactivar y reactivar funciona.
    const apagado = await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: false }
    });
    assert.equal(apagado.estado, 200);

    const encendido = await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: true }
    });
    assert.equal(encendido.estado, 200);

    // Y con la empresa activa y un administrador, desactivar sigue funcionando:
    // es el caso normal.
    const otroApagado = await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: false }
    });
    assert.equal(otroApagado.estado, 200);

    // Sin ningún administrador activo no se puede dejar desactivada: nadie
    // podría volver a encenderla.
    await prisma.user.updateMany({
      where: { businessId: idNegocio, role: "ADMIN" },
      data: { activo: false }
    });

    const trampa = await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: true }
    });
    assert.equal(trampa.estado, 200, "reactivar siempre es posible");

    const volverApagar = await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: false }
    });
    assert.equal(volverApagar.estado, 409, "desactivar sin admins activos se rechaza");
  } finally {
    await prisma.business.deleteMany({ where: { id: idNegocio } });
  }
});

test("la info pública de un negocio sólo responde si está activo", async () => {
  const slug = `publico-${Date.now()}`;
  const creado = await pedir("/api/super/negocios", {
    metodo: "POST",
    token: tokens.super,
    cuerpo: {
      nombre: "Empresa pública",
      slug,
      adminNombre: "Admin Público",
      adminEmail: `publico.${Date.now()}@ejemplo.com`,
      adminPassword: "Pruebas1234"
    }
  });
  assert.equal(creado.estado, 201, creado.datos?.error);
  const idNegocio = creado.datos.negocio.id;

  try {
    const info = await pedir(`/api/negocios/${slug}`);
    assert.equal(info.estado, 200);
    assert.equal(info.datos.negocio.slug, slug);
    assert.equal(info.datos.negocio.passwordHash, undefined, "no debe filtrar nada de la cuenta");

    // No hace falta token: la página de acceso lo pinta antes de pedirlo.
    const sinToken = await pedir(`/api/negocios/${slug}`);
    assert.equal(sinToken.estado, 200);

    await pedir(`/api/super/negocios/${idNegocio}`, {
      metodo: "PATCH",
      token: tokens.super,
      cuerpo: { activo: false }
    });
    const trasDesactivar = await pedir(`/api/negocios/${slug}`);
    assert.equal(trasDesactivar.estado, 404, "una empresa desactivada desaparece de la vía pública");

    const inexistente = await pedir("/api/negocios/no-existe-nada");
    assert.equal(inexistente.estado, 404);
  } finally {
    await prisma.business.deleteMany({ where: { id: idNegocio } });
  }
});

test("las páginas de cada negocio se sirven con su propio identificador", async () => {
  const marca = Date.now();
  const slug = `paginas-${marca}`;
  const creado = await pedir("/api/super/negocios", {
    metodo: "POST",
    token: tokens.super,
    cuerpo: {
      nombre: "Empresa de páginas",
      slug,
      adminNombre: "Admin De Páginas",
      adminEmail: `paginas.${marca}@ejemplo.com`,
      adminPassword: "Pruebas1234"
    }
  });
  const idNegocio = creado.datos.negocio.id;

  try {
    // /b/slug lleva a /b/slug/login, y ambas páginas existen.
    const raiz = await fetch(`${base}/b/${slug}`, { redirect: "manual" });
    assert.equal(raiz.status, 302);
    assert.equal(raiz.headers.get("location"), `/b/${slug}/login`);

    for (const pagina of [`/b/${slug}/login`, `/b/${slug}/registro`]) {
      const respuesta = await fetch(`${base}${pagina}`);
      assert.equal(respuesta.status, 200, `${pagina} debería servir`);
    }
  } finally {
    await prisma.business.deleteMany({ where: { id: idNegocio } });
  }
});

test("un cliente de una empresa no puede ver los clientes de otra por HTTP", async () => {
  const { ana, luis } = await cuentas();

  // Ana y Luis están en la misma empresa, así que 403.
  const mismaEmpresa = await pedir(`/api/clients/${luis.client.id}`, { token: tokens.ana });
  assert.equal(mismaEmpresa.estado, 403);

  // El cliente de la barbería sí está en otra empresa: no existe para Ana.
  const marta = await prisma.user.findUnique({ where: { email: "marta@barberia.com" }, include: { client: true } });
  if (!marta) {
    return; // el seed no dejó la segunda empresa
  }
  assert.notEqual(marta.client.businessId, ana.client.businessId, "deben estar en negocios distintos");

  /* 404 y no 403 a propósito: un cliente de otra empresa no puede ni saber si
     ese id existe. Con un 403 se confirmaría que ahí hay un cliente con ese
     número, que es justo el dato que el aislamiento debe esconder. */
  const otraEmpresa = await pedir(`/api/clients/${marta.client.id}`, { token: tokens.ana });
  assert.equal(otraEmpresa.estado, 404, "la ficha de otro negocio no existe para ella");

  // Y tampoco puede tocar sus citas, aunque conozca el identificador.
  const citaBarberia = await prisma.appointment.findFirst({
    where: { businessId: marta.client.businessId },
    select: { id: true }
  });
  if (citaBarberia) {
    // Lectura: 404, para no confirmar que ese id existe.
    const abrir = await pedir(`/api/appointments/${citaBarberia.id}`, { token: tokens.ana });
    assert.equal(abrir.estado, 404, "la cita de otro negocio no existe para ella");

    /* Escritura: aquí salta antes requireAdmin, y el 403 es lo correcto. El rol
       se comprueba antes que la empresa, así que un cliente recibe 403 tanto si
       la cita es de su negocio como si no: el borrado es de administración y
       punto. No hace falta que la empresa lo compruebe detrás. */
    const borrar = await pedir(`/api/appointments/${citaBarberia.id}`, {
      metodo: "DELETE",
      token: tokens.ana
    });
    assert.equal(borrar.estado, 403, "borrar citas es sólo de administración");

    const intacta = await prisma.appointment.findUnique({ where: { id: citaBarberia.id } });
    assert.ok(intacta, "ningún intento ajeno la ha tocado");

    // Y el administrador de la otra empresa tampoco puede verla: 404, no 403.
    const adminBarberia = await pedir("/api/auth/login", {
      metodo: "POST",
      cuerpo: { email: "admin@barberia.com", password: "Admin1234", negocio: "barberia" }
    });
    if (adminBarberia.estado === 200) {
      const conAdminAjeno = await pedir(`/api/appointments/${citaBarberia.id}`, {
        token: adminBarberia.datos.token
      });
      assert.equal(conAdminAjeno.estado, 200, "para su propio administrador sí existe");

      // El de la principal, en cambio, recibe 404.
      const conAdminPrincipal = await pedir(`/api/appointments/${citaBarberia.id}`, { token: tokens.admin });
      assert.equal(conAdminPrincipal.estado, 404, "otro administrador sí recibe 404");
    }
  }
});
