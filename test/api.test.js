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
  return { admin, ana, luis };
}

let tokens = {};

test.before(async () => {
  const { admin, ana, luis } = await cuentas();
  const entradaAdmin = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: admin.email, password: "Admin1234" }
  });
  const entradaAna = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: ana.email, password: "Cliente1234" }
  });
  const entradaLuis = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: luis.email, password: "Cliente1234" }
  });

  tokens = {
    admin: entradaAdmin.datos.token,
    ana: entradaAna.datos.token,
    luis: entradaLuis.datos.token
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
    cuerpo: { email: admin.email, password: "Admin1234" }
  });
  assert.equal(adminLogin.estado, 200);
  assert.equal(adminLogin.datos.user.role, "ADMIN");
  assert.equal(adminLogin.datos.user.passwordHash, undefined, "nunca debe viajar el hash");

  const clienteLogin = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: ana.email, password: "Cliente1234" }
  });
  assert.equal(clienteLogin.estado, 200);
  assert.equal(clienteLogin.datos.user.role, "CLIENT");
  assert.equal(clienteLogin.datos.client.documento, "12345678A");
});

test("una contraseña incorrecta no dice si el correo existe", async () => {
  const malPass = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: "ana@ejemplo.com", password: "Incorrecta999" }
  });
  const inexistente = await pedir("/api/auth/login", {
    metodo: "POST",
    cuerpo: { email: "nadie@ejemplo.com", password: "Incorrecta999" }
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
