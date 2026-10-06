import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/config/database.js";
import * as authService from "../src/services/auth.service.js";
import * as appointmentService from "../src/services/appointment.service.js";
import * as availabilityService from "../src/services/availability.service.js";
import * as businessService from "../src/services/business.service.js";
import * as clientService from "../src/services/client.service.js";
import * as taskService from "../src/services/task.service.js";
import { parseDisponibilidad } from "../src/validators/availability.validator.js";
import { hoyMasDias } from "../src/utils/date.js";

/**
 * Pruebas de las reglas de negocio (§12). Se ejecutan contra la base de
 * desarrollo, pero cada test trabaja sobre datos que crea y borra él mismo, así
 * que no dependen del seed ni se pisan entre ellos.
 *
 * MULTI-NEGOCIO
 * Todas las reglas se comprueban contra empresas reales, no contra un negocio
 * único implícito. Las pruebas usan dos ("pruebas-a" y "pruebas-b") creadas y
 * destruidas por este archivo, de modo que:
 *
 *   1) Cada servicio se llama con el businessId que le toca, igual que lo hace
 *      el controlador tras leerlo del token. Antes del multi-negocio esas
 *      llamadas no llevaban nada y los ids salían sin acotar.
 *   2) El bloque final comprueba que un negocio no puede tocar los datos del
 *      otro. Esa garantía es el motivo de que el esquema lleve businessId en
 *      todas partes, así que tiene que tener pruebas propias.
 *
 *   npm test
 */

const SLUG_A = "pruebas-a";
const SLUG_B = "pruebas-b";
const EMAIL_ADMIN_A = "admin.a@pruebas.local";
const EMAIL_ADMIN_B = "admin.b@pruebas.local";

/** Los dos negocios de prueba y sus administradores. Se rellenan en `before`. */
let negocioA;
let adminA;
let negocioB;
let adminB;

/**
 * Los negocios se crean con el servicio real (el mismo que usa el
 * superadministrador), no a mano: así también se comprueba que nacen con sus
 * categorías base y que su primer administrador queda ligado al negocio.
 */
async function crearNegocioDePrueba(slug, nombre, email) {
  return businessService.crearNegocio({
    nombre,
    slug,
    descripcion: `Negocio temporal de pruebas (${slug}).`,
    admin: { nombre: `Admin de ${slug}`, email, password: "Pruebas1234" }
  });
}

async function prepararNegocios() {
  // Una ejecución anterior pudo quedar a medias, así que se empieza de cero.
  await prisma.business.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN_A, EMAIL_ADMIN_B] } } });

  negocioA = await crearNegocioDePrueba(SLUG_A, "Pruebas A", EMAIL_ADMIN_A);
  adminA = negocioA.users[0];
  negocioB = await crearNegocioDePrueba(SLUG_B, "Pruebas B", EMAIL_ADMIN_B);
  adminB = negocioB.users[0];
}

test.before(prepararNegocios);

test.after(async () => {
  await prisma.business.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN_A, EMAIL_ADMIN_B] } } });
  await prisma.$disconnect();
});

async function crearCliente(email, slug = SLUG_A) {
  return authService.registrarCliente({
    nombre: "Cliente de Prueba",
    email,
    password: "Pruebas1234",
    negocio: slug,
    documento: `DOC${Math.floor(Math.random() * 1e9)}`,
    fechaNacimiento: "1990-01-01",
    telefono: "600000000",
    direccion: null
  });
}

/**
 * Crea un hueco AVAILABLE en un negocio. La hora se calcula a partir de un
 * contador para que cada test use un inicio distinto y no choque con el seed ni
 * con otros tests (el esquema impide repetir fecha + hora de inicio DENTRO de un
 * negocio).
 */
/** Igual que crearHuecoLibre, pero con hora fija: para probar el duplicado. */
async function crearHuecoLibreEn(fecha, hora, businessId = negocioA.id) {
  return availabilityService.crearDisponibilidad(
    {
      date: fecha,
      startTime: hora,
      endTime: "23:00",
      status: "AVAILABLE",
      note: null
    },
    businessId
  );
}

/** Hueco a bastante distancia del seed, con hora fija por test. */
async function crearHuecoLibreLejos(dias, businessId = negocioA.id) {
  return crearHuecoLibreEn(hoyMasDias(120 + dias), "10:00", businessId);
}

let contadorHuecos = 0;
async function crearHuecoLibre(dias = 1) {
  // El esquema impide repetir (fecha, hora de inicio), así que cada hueco de
  // prueba avanza 30 minutos. Así no choca ni con el seed ni entre tests.
  const inicioMinutos = 9 * 60 + contadorHuecos * 30;
  contadorHuecos += 1;
  const hora = `${String(Math.floor(inicioMinutos / 60)).padStart(2, "0")}:${String(inicioMinutos % 60).padStart(2, "0")}`;

  return crearHuecoLibreEn(hoyMasDias(dias), hora);
}

async function limpiar(ids) {
  await prisma.notification.deleteMany({ where: { appointmentId: { in: ids.citas } } });
  await prisma.appointmentEvent.deleteMany({ where: { appointmentId: { in: ids.citas } } });
  await prisma.appointment.deleteMany({ where: { id: { in: ids.citas } } });
  await prisma.availability.deleteMany({ where: { id: { in: ids.disponibilidades } } });
  await prisma.task.deleteMany({ where: { id: { in: ids.tareas } } });
  // Toda cita nace con su tarea, y esa tarea sobrevive al borrado de la cita.
  // Como la tarea de la prueba siempre lleva su cliente, se localizan por ahí
  // para que ninguna ejecución deje trabajo basura en la base de desarrollo.
  if (ids.clientes.length > 0) {
    const clientes = await prisma.client.findMany({
      where: { userId: { in: ids.clientes } },
      select: { id: true }
    });
    const idsClientes = clientes.map((cliente) => cliente.id);
    await prisma.task.deleteMany({ where: { clientId: { in: idsClientes } } });
    await prisma.client.deleteMany({ where: { userId: { in: ids.clientes } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.clientes } } });
  }
}

/** Estructura vacía de ids, para no repetirla en cada test. */
const idsVacios = () => ({ citas: [], tareas: [], disponibilidades: [], clientes: [] });

/** El administrador de "pruebas-a", que hace de actor en los cambios de estado. */
async function admin() {
  return adminA;
}

/** Pide un hueco a un cliente y devuelve la cita creada. */
async function reservar({ cliente, hueco, title = "Reparación", actorId }) {
  return appointmentService.solicitarCita({
    cliente,
    availabilityId: hueco.id,
    categoryId: null,
    title,
    note: null,
    actorId: actorId ?? cliente.userId
  });
}

/* ------------------------------------------------------------------ *
 * Disponibilidad
 * ------------------------------------------------------------------ */

test("no se puede publicar dos horarios que empiezan a la misma hora", async () => {
  const fecha = hoyMasDias(5);
  const ids = idsVacios();
  try {
    const primero = await crearHuecoLibreEn(fecha, "10:00");
    ids.disponibilidades.push(primero.id);

    await assert.rejects(
      () => crearHuecoLibreEn(fecha, "10:00"),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

test("la hora de fin debe ser posterior a la de inicio", () => {
  // La regla vive en el validador, que es la primera línea tras el JSON.
  assert.throws(
    () =>
      parseDisponibilidad({
        date: hoyMasDias(5),
        startTime: "16:00",
        endTime: "15:00",
        status: "AVAILABLE"
      }),
    (error) => error.estado === 422
  );

  // Y un horario de más de 4 horas tampoco se publica.
  assert.throws(
    () =>
      parseDisponibilidad({
        date: hoyMasDias(5),
        startTime: "09:00",
        endTime: "15:00",
        status: "AVAILABLE"
      }),
    (error) => error.estado === 422
  );

  // No se publica disponibilidad en el pasado.
  assert.throws(
    () =>
      parseDisponibilidad({
        date: "2020-01-15",
        startTime: "10:00",
        endTime: "11:00",
        status: "AVAILABLE"
      }),
    (error) => error.estado === 422
  );
});

/* ------------------------------------------------------------------ *
 * Flujo de reserva: el escenario de aceptación (§29)
 * ------------------------------------------------------------------ */

test("el flujo completo deja la cita, la tarea y la disponibilidad como debe", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`flujo.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(1);
    ids.disponibilidades.push(hueco.id);

    // 1) El cliente solicita la cita.
    const cita = await reservar({ cliente: usuario.client, hueco, title: "Instalación" });
    ids.citas.push(cita.id);

    assert.equal(cita.status, "PENDING", "la cita nace pendiente de revisión");
    assert.ok(cita.taskId, "la cita tiene su tarea");
    assert.equal(cita.task.title, "Instalación", "la tarea hereda el título del servicio");
    assert.equal(cita.businessId, negocioA.id, "la cita nace en el negocio del cliente");

    const tareaCreada = await prisma.task.findUnique({ where: { id: cita.taskId } });
    assert.equal(tareaCreada.clientId, usuario.client.id, "la tarea queda ligada al cliente");
    assert.equal(tareaCreada.status, "PENDING");

    // 2) El hueco queda bloqueado para que nadie más lo ocupe.
    const bloqueado = await prisma.availability.findUnique({ where: { id: hueco.id } });
    assert.equal(bloqueado.status, "HELD", "el hueco pasa a HELD al solicitar");

    // 3) El administrador avisa a los clientes que hay una solicitud nueva.
    const avisos = await prisma.notification.findMany({ where: { appointmentId: cita.id } });
    assert.ok(
      avisos.some((aviso) => aviso.type === "NEW_REQUEST" && aviso.userId === jefe.id),
      "se avisa a los administradores de la solicitud"
    );

    // 4) El administrador confirma.
    await appointmentService.cambiarEstadoCita({
      citaId: cita.id,
      nuevoEstado: "COORDINATED",
      actorId: jefe.id,
      note: "Confirmado por teléfono",
      businessId: negocioA.id
    });

    const coordinada = await appointmentService.obtenerCita(cita.id);
    assert.equal(coordinada.status, "COORDINATED");

    const reservado = await prisma.availability.findUnique({ where: { id: hueco.id } });
    assert.equal(reservado.status, "RESERVED", "al coordinar el hueco pasa de HELD a RESERVED");

    // 5) Y el cliente se entera.
    const avisoCliente = await prisma.notification.findFirst({
      where: { appointmentId: cita.id, userId: usuario.id, type: "APPOINTMENT_COORDINATED" }
    });
    assert.ok(avisoCliente, "el cliente recibe la notificación de coordinación");

    // 6) El historial cuenta lo que pasó.
    const conHistorial = await appointmentService.obtenerCita(cita.id, { conHistorial: true });
    assert.equal(conHistorial.events.length, 2, "un evento al crear y otro al coordinar");
    assert.equal(conHistorial.events[0].toStatus, "COORDINATED");
    assert.equal(conHistorial.events[0].actorId, jefe.id, "el evento guarda quién lo hizo");
  } finally {
    await limpiar(ids);
  }
});

test("dos clientes no pueden quedarse con el mismo horario", async () => {
  const ids = idsVacios();
  try {
    const { usuario: primero } = await crearCliente(`carrera1.${Date.now()}@ejemplo.com`);
    const { usuario: segundo } = await crearCliente(`carrera2.${Date.now()}@ejemplo.com`);
    ids.clientes.push(primero.id, segundo.id);

    const hueco = await crearHuecoLibreLejos(2);
    ids.disponibilidades.push(hueco.id);

    const primera = await reservar({ cliente: primero.client, hueco });
    ids.citas.push(primera.id);

    // El compare-and-swap del servicio es lo que lo impide: el segundo UPDATE
    // condicional no afecta a ninguna fila.
    await assert.rejects(
      () => reservar({ cliente: segundo.client, hueco }),
      (error) => error.estado === 409
    );

    const citasDelHueco = await prisma.appointment.count({ where: { availabilityId: hueco.id } });
    assert.equal(citasDelHueco, 1, "el hueco sigue teniendo una sola cita");
  } finally {
    await limpiar(ids);
  }
});

test("no se puede reservar un horario bloqueado ni uno que ya ha pasado", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`bloqueado.${Date.now()}@ejemplo.com`);
    ids.clientes.push(usuario.id);

    const bloqueado = await prisma.availability.create({
      data: {
        businessId: negocioA.id,
        date: new Date(`${hoyMasDias(6)}T00:00:00.000Z`),
        startTime: "07:00",
        endTime: "08:00",
        status: "BLOCKED",
        note: "Reunión interna"
      }
    });
    ids.disponibilidades.push(bloqueado.id);

    await assert.rejects(
      () => reservar({ cliente: usuario.client, hueco: bloqueado }),
      (error) => error.estado === 409
    );

    // Un hueco AVAILABLE en pasado es un dato sucio: también se rechaza.
    const pasado = await prisma.availability.create({
      data: {
        businessId: negocioA.id,
        date: new Date("2020-01-15T00:00:00.000Z"),
        startTime: "07:00",
        endTime: "08:00",
        status: "AVAILABLE"
      }
    });
    ids.disponibilidades.push(pasado.id);

    await assert.rejects(
      () => reservar({ cliente: usuario.client, hueco: pasado }),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

test("una cita rechazada libera el horario para poder reutilizarlo", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`rechazo.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(3);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    ids.citas.push(cita.id);

    await appointmentService.cambiarEstadoCita({
      citaId: cita.id,
      nuevoEstado: "REJECTED",
      actorId: jefe.id,
      note: "El cliente pidió otro día.",
      businessId: negocioA.id
    });

    const liberado = await prisma.availability.findUnique({ where: { id: hueco.id } });
    assert.equal(liberado.status, "AVAILABLE", "al rechazar, el hueco vuelve a estar libre");

    // Y otro cliente puede reservarlo: por eso Appointment.availabilityId no lleva UNIQUE.
    const { usuario: otro } = await crearCliente(`rechazo2.${Date.now()}@ejemplo.com`);
    ids.clientes.push(otro.id);

    const reutilizado = await reservar({ cliente: otro.client, hueco, title: "Segundo trabajo" });
    ids.citas.push(reutilizado.id);
    assert.equal(reutilizado.availabilityId, hueco.id);
  } finally {
    await limpiar(ids);
  }
});

test("las transiciones que no están permitidas se rechazan", async () => {
  assert.ok(appointmentService.puedeTransicionar("PENDING", "COORDINATED"));
  assert.ok(appointmentService.puedeTransicionar("COORDINATED", "COMPLETED"));

  // Una cita confirmada no vuelve a "pendiente" sin pasar por cancelada.
  assert.ok(!appointmentService.puedeTransicionar("COORDINATED", "PENDING"));
  assert.ok(!appointmentService.puedeTransicionar("COMPLETED", "COORDINATED"));
  assert.ok(!appointmentService.puedeTransicionar("PENDING", "COMPLETED"));
  assert.ok(!appointmentService.puedeTransicionar("REJECTED", "COORDINATED"));
  assert.ok(!appointmentService.puedeTransicionar("CANCELLED", "COMPLETED"));
});

test("no se puede saltar de PENDING a COMPLETED sobre una cita real", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`salto.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(4);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    ids.citas.push(cita.id);

    await assert.rejects(
      () =>
        appointmentService.cambiarEstadoCita({
          citaId: cita.id,
          nuevoEstado: "COMPLETED",
          actorId: jefe.id,
          businessId: negocioA.id
        }),
      (error) => error.estado === 409
    );

    // Y si el hueco ya no está bloqueado, el cambio también falla en vez de
    // dejar la cita y la disponibilidad descuadradas.
    await prisma.availability.update({ where: { id: hueco.id }, data: { status: "AVAILABLE" } });
    await assert.rejects(
      () =>
        appointmentService.cambiarEstadoCita({
          citaId: cita.id,
          nuevoEstado: "CANCELLED",
          actorId: jefe.id,
          businessId: negocioA.id
        }),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

test("reprogramar libera el hueco viejo y ocupa el nuevo", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`reprogramar.${Date.now()}@ejemplo.com`);
    ids.clientes.push(usuario.id);

    const viejo = await crearHuecoLibreLejos(5);
    const nuevo = await crearHuecoLibreLejos(6);
    ids.disponibilidades.push(viejo.id, nuevo.id);

    const cita = await reservar({ cliente: usuario.client, hueco: viejo });
    ids.citas.push(cita.id);

    await appointmentService.reprogramarCita({
      citaId: cita.id,
      availabilityId: nuevo.id,
      actorId: usuario.id,
      businessId: negocioA.id
    });

    const estados = await Promise.all([
      prisma.availability.findUnique({ where: { id: viejo.id } }),
      prisma.availability.findUnique({ where: { id: nuevo.id } })
    ]);
    assert.equal(estados[0].status, "AVAILABLE", "el hueco viejo queda libre");
    assert.equal(estados[1].status, "HELD", "el nuevo queda bloqueado para la cita");

    // Reprogramar al mismo hueco no tiene sentido.
    await assert.rejects(
      () =>
        appointmentService.reprogramarCita({
          citaId: cita.id,
          availabilityId: nuevo.id,
          actorId: usuario.id,
          businessId: negocioA.id
        }),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

test("el cliente cancela su cita pendiente y el hueco vuelve a estar libre", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`cancelar.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(7);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    ids.citas.push(cita.id);

    await appointmentService.cancelarCitaDelCliente({
      citaId: cita.id,
      clienteId: usuario.client.id,
      actorId: usuario.id
    });

    const citaCancelada = await appointmentService.obtenerCita(cita.id);
    assert.equal(citaCancelada.status, "CANCELLED");

    const liberado = await prisma.availability.findUnique({ where: { id: hueco.id } });
    assert.equal(liberado.status, "AVAILABLE", "su cita cancelada devuelve el hueco");

    // Ya no se puede cancelar dos veces, y el administrador se entera.
    await assert.rejects(
      () => appointmentService.cancelarCitaDelCliente({ citaId: cita.id, clienteId: usuario.client.id }),
      (error) => error.estado === 409
    );

    const avisos = await prisma.notification.findMany({ where: { appointmentId: cita.id } });
    assert.ok(
      avisos.some((aviso) => aviso.type === "APPOINTMENT_CANCELLED" && aviso.userId === jefe.id),
      "se avisa a los administradores de la cancelación"
    );
  } finally {
    await limpiar(ids);
  }
});

test("un cliente no puede cancelar una cita que ya está coordinada", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`nocancelar.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(8);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    ids.citas.push(cita.id);

    await appointmentService.cambiarEstadoCita({
      citaId: cita.id,
      nuevoEstado: "COORDINATED",
      actorId: jefe.id,
      businessId: negocioA.id
    });

    await assert.rejects(
      () =>
        appointmentService.cancelarCitaDelCliente({
          citaId: cita.id,
          clienteId: usuario.client.id,
          actorId: usuario.id
        }),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

/* ------------------------------------------------------------------ *
 * Aislamiento entre clientes (§12, reglas 8 y 10)
 * ------------------------------------------------------------------ */

test("un cliente no ve ni toca las citas de otro", async () => {
  const ids = idsVacios();
  try {
    const { usuario: dueno } = await crearCliente(`dueno.${Date.now()}@ejemplo.com`);
    const { usuario: intruso } = await crearCliente(`intruso.${Date.now()}@ejemplo.com`);
    ids.clientes.push(dueno.id, intruso.id);

    const hueco = await crearHuecoLibreLejos(10);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: dueno.client, hueco });
    ids.citas.push(cita.id);

    // El filtro de cliente se impone en el servicio: no basta con quitar el id
    // de la URL, porque la lista ya viene acotada.
    const suyas = await appointmentService.listarCitas(
      { limit: 100 },
      { clienteId: intruso.client.id, businessId: negocioA.id }
    );
    assert.ok(!suyas.items.some((item) => item.id === cita.id), "la cita ajena no sale en su listado");

    // Y al abrirla por id, aunque sepa el número.
    assert.throws(
      () => appointmentService.exigirAcceso(cita, { esAdmin: false, clienteId: intruso.client.id }),
      (error) => error.estado === 403
    );
    assert.throws(
      () => appointmentService.exigirAcceso(cita, { esAdmin: false, clienteId: null }),
      (error) => error.estado === 403
    );
    // El administrador, en cambio, pasa siempre.
    appointmentService.exigirAcceso(cita, { esAdmin: true, clienteId: null });

    await assert.rejects(
      () => appointmentService.cancelarCitaDelCliente({ citaId: cita.id, clienteId: intruso.client.id }),
      (error) => error.estado === 403
    );
  } finally {
    await limpiar(ids);
  }
});

test("eliminar una cita devuelve su horario a la lista de libres", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`borrarcita.${Date.now()}@ejemplo.com`);
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(11);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    await appointmentService.eliminarCita(cita.id, negocioA.id);

    const liberado = await prisma.availability.findUnique({ where: { id: hueco.id } });
    assert.equal(liberado.status, "AVAILABLE", "al borrar la cita el hueco vuelve a estar libre");

    // La tarea que nació con la cita se queda, pero ya sin cita detrás: pasa a
    // formar parte de las tareas propias del administrador.
    const tareas = await taskService.listarTareas({ alcance: "propias", limit: 500 }, negocioA.id);
    assert.ok(
      tareas.items.some((tarea) => tarea.id === cita.taskId),
      "la tarea superviviente se ve entre las propias"
    );
  } finally {
    await limpiar(ids);
  }
});

test("al completar la cita, la tarea también se cierra", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`cierre.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(9);
    ids.disponibilidades.push(hueco.id);

    const cita = await appointmentService.solicitarCita({
      cliente: usuario.client,
      availabilityId: hueco.id,
      categoryId: null,
      title: "Reparación",
      note: null,
      actorId: usuario.id
    });
    ids.citas.push(cita.id);
    ids.tareas.push(cita.taskId);

    await appointmentService.cambiarEstadoCita({
      citaId: cita.id,
      nuevoEstado: "COORDINATED",
      actorId: jefe.id,
      businessId: negocioA.id
    });
    await appointmentService.cambiarEstadoCita({
      citaId: cita.id,
      nuevoEstado: "COMPLETED",
      actorId: jefe.id,
      businessId: negocioA.id
    });

    const tarea = await prisma.task.findUnique({ where: { id: cita.taskId } });
    assert.equal(tarea.status, "COMPLETED");
  } finally {
    await limpiar(ids);
  }
});

/* ------------------------------------------------------------------ *
 * Reglas de disponibilidad y tareas
 * ------------------------------------------------------------------ */

test("no se puede borrar un horario con una cita asociada", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`borrarhueco.${Date.now()}@ejemplo.com`);
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(15);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    ids.citas.push(cita.id);

    await assert.rejects(
      () => availabilityService.eliminarDisponibilidad(hueco.id, negocioA.id),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

test("un horario reservado no se puede mover de fecha ni de hora", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`mover.${Date.now()}@ejemplo.com`);
    const jefe = await admin();
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(16);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco });
    ids.citas.push(cita.id);
    await appointmentService.cambiarEstadoCita({
      citaId: cita.id,
      nuevoEstado: "COORDINATED",
      actorId: jefe.id,
      businessId: negocioA.id
    });

    await assert.rejects(
      () => availabilityService.actualizarDisponibilidad(hueco.id, { startTime: "12:00" }, negocioA.id),
      (error) => error.estado === 409
    );
    // Cambiar la nota, en cambio, sí se permite.
    const anotado = await availabilityService.actualizarDisponibilidad(hueco.id, { note: "Confirmado" }, negocioA.id);
    assert.equal(anotado.note, "Confirmado");
  } finally {
    await limpiar(ids);
  }
});

test("una tarea puede existir sin fecha y aparece en 'sin-fecha'", async () => {
  const tarea = await taskService.crearTarea(
    {
      title: "Comprar materiales",
      description: null,
      categoryId: null,
      clientId: null,
      dueDate: null,
      dueTime: null,
      status: undefined
    },
    negocioA.id
  );

  try {
    assert.equal(tarea.dueDate, null);

    const { items } = await taskService.listarTareas({ filtro: "sin-fecha" }, negocioA.id);
    assert.ok(
      items.some((t) => t.id === tarea.id),
      "la tarea sin fecha debe salir en el filtro"
    );
  } finally {
    await prisma.task.delete({ where: { id: tarea.id } });
  }
});

test("una tarea puede existir sin cliente y sin categoría", async () => {
  const tarea = await taskService.crearTarea(
    {
      title: "Tarea huérfana",
      description: null,
      categoryId: null,
      clientId: null,
      dueDate: null,
      dueTime: null,
      status: undefined
    },
    negocioA.id
  );

  try {
    assert.equal(tarea.clientId, null);
    assert.equal(tarea.categoryId, null);
    assert.equal(tarea.dueDate, null);
    assert.equal(tarea.status, "PENDING");
  } finally {
    await prisma.task.delete({ where: { id: tarea.id } });
  }
});

test("eliminar una categoría deja sus tareas sin clasificar", async () => {
  const categoria = await prisma.category.create({
    data: { businessId: negocioA.id, name: "TEMP-" + Date.now() }
  });
  const tarea = await prisma.task.create({
    data: { businessId: negocioA.id, title: "Con categoría temporal", categoryId: categoria.id }
  });

  try {
    await prisma.category.delete({ where: { id: categoria.id } });

    const superviviente = await prisma.task.findUnique({ where: { id: tarea.id } });
    assert.ok(superviviente, "la tarea no debe borrarse");
    assert.equal(superviviente.categoryId, null, "debe quedar sin categoría");
  } finally {
    await prisma.task.delete({ where: { id: tarea.id } });
  }
});

/**
 * El alcance separa el trabajo del administrador de las tareas que nacen al
 * registrar una cita. Con muchas citas, la lista de trabajo se llenaría de
 * tareas que ya se gestionan en "Citas", así que "propias" las aparta.
 */
test("el alcance separa las tareas propias de las que nacen de una cita", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`alcance.${Date.now()}@ejemplo.com`);
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(13);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco, title: "Trabajo con cita" });
    ids.citas.push(cita.id);

    const propia = await prisma.task.create({
      data: { businessId: negocioA.id, title: "Tarea propia del alcance" }
    });
    ids.tareas.push(propia.id);

    const propias = await taskService.listarTareas({ alcance: "propias", limit: 500 }, negocioA.id);
    const deCitas = await taskService.listarTareas({ alcance: "de-citas", limit: 500 }, negocioA.id);
    const todas = await taskService.listarTareas({ limit: 500 }, negocioA.id);

    assert.ok(propias.items.some((t) => t.id === propia.id), "la propia sale en alcance=propias");
    assert.ok(!propias.items.some((t) => t.id === cita.taskId), "la de cita no sale en alcance=propias");

    assert.ok(deCitas.items.some((t) => t.id === cita.taskId), "la de cita sale en alcance=de-citas");
    assert.ok(!deCitas.items.some((t) => t.id === propia.id), "la propia no sale en alcance=de-citas");

    assert.equal(
      propias.total + deCitas.total,
      todas.total,
      "los dos alcances juntos deben ser todas las tareas, sin repetir ni perder"
    );
  } finally {
    await limpiar(ids);
  }
});

test("el alcance se combina con los demás filtros", async () => {
  const ids = idsVacios();
  try {
    const { usuario } = await crearCliente(`alcance2.${Date.now()}@ejemplo.com`);
    ids.clientes.push(usuario.id);

    const hueco = await crearHuecoLibreLejos(14);
    ids.disponibilidades.push(hueco.id);

    // "agendadas" acota por fecha; el alcance decide si esa tarea cuenta.
    const cita = await reservar({ cliente: usuario.client, hueco, title: "Cita con fecha marcada" });
    ids.citas.push(cita.id);
    await prisma.task.update({ where: { id: cita.taskId }, data: { dueDate: new Date(Date.UTC(2031, 0, 8)) } });

    const propia = await prisma.task.create({
      data: { businessId: negocioA.id, title: "Tarea propia agendada", dueDate: new Date(Date.UTC(2031, 0, 9)) }
    });
    ids.tareas.push(propia.id);

    const rango = { desde: "2031-01-01", hasta: "2031-01-31", limit: 500 };
    const agendadasPropias = await taskService.listarTareas(
      { ...rango, alcance: "propias", filtro: "agendadas" },
      negocioA.id
    );
    const agendadasDeCitas = await taskService.listarTareas(
      { ...rango, alcance: "de-citas", filtro: "agendadas" },
      negocioA.id
    );

    assert.ok(
      !agendadasPropias.items.some((t) => t.id === cita.taskId),
      "una tarea de cita no puede colarse en 'propias y agendadas'"
    );
    assert.ok(
      agendadasPropias.items.some((t) => t.id === propia.id),
      "la propia agendada sí debe salir"
    );
    assert.ok(
      agendadasDeCitas.items.some((t) => t.id === cita.taskId),
      "la de cita agendada sale en su alcance"
    );
  } finally {
    await limpiar(ids);
  }
});

/**
 * Borrar un cliente no puede plantar tareas zombis en "Mis tareas".
 *
 * La cascada del usuario borra sus citas, pero Task.clientId está en SetNull: sin
 * este cuidado, cada cliente eliminado dejaba su tarea de cita viva, sin cliente
 * y sin cita, y el administrador la encontraba en su lista sin saber de dónde
 * salió. Era un fallo silencioso que sólo se notaba al contar.
 */
test("eliminar un cliente no deja tareas sueltas en la lista de trabajo", async () => {
  const ids = idsVacios();
  const { usuario } = await crearCliente(`zombis.${Date.now()}@ejemplo.com`);
  const jefe = await admin();
  ids.clientes.push(usuario.id);

  try {
    const hueco = await crearHuecoLibreLejos(17);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: usuario.client, hueco, title: "Trabajo que se va con el cliente" });
    // Una tarea propia del administrador, asignada a mano a ese cliente: ÉSTA sí
    // debe sobrevivir al borrado, porque es trabajo suyo y no de la cita.
    const tareaPropia = await prisma.task.create({
      data: { businessId: negocioA.id, title: "Tarea asignada a mano", clientId: usuario.client.id }
    });
    ids.tareas.push(tareaPropia.id);

    const antes = await taskService.listarTareas({ alcance: "propias", limit: 500 }, negocioA.id);
    assert.ok(!antes.items.some((t) => t.id === cita.taskId), "antes, la tarea de la cita es de cita");

    await clientService.eliminarCliente(usuario.client.id, jefe);

    // La cita y su tarea se han ido.
    const citas = await prisma.appointment.count({ where: { id: cita.id } });
    assert.equal(citas, 0, "la cita se borra en cascada");

    const tareaDeLaCita = await prisma.task.findUnique({ where: { id: cita.taskId } });
    assert.equal(tareaDeLaCita, null, "la tarea que nació de la cita también se va");

    // Pero la tarea que el administrador creó a mano se queda, aunque su cliente
    // ya no exista.
    const superviviente = await prisma.task.findUnique({ where: { id: tareaPropia.id } });
    assert.ok(superviviente, "la tarea asignada a mano no se borra");
    assert.equal(superviviente.clientId, null, "pero pierde el cliente, que ya no existe");

    // Y no queda ninguna tarea huérfana con el nombre de la cita.
    const propias = await taskService.listarTareas({ alcance: "propias", limit: 500 }, negocioA.id);
    assert.ok(
      !propias.items.some((t) => t.title === "Trabajo que se va con el cliente"),
      "no debe quedar ninguna tarea de la cita en la lista del administrador"
    );
  } finally {
    await limpiar(ids);
  }
});

/* ------------------------------------------------------------------ *
 * Aislamiento entre negocios
 *
 * El motivo de que businessId esté en Task, Availability, Category y Client: dos
 * empresas que comparten la app no pueden pisarse. Estas pruebas fijan esa
 * frontera, que es la garantía nueva del multi-negocio.
 * ------------------------------------------------------------------ */

test("las claves que eran globales ahora son únicas dentro de cada negocio", async () => {
  const ids = idsVacios();
  try {
    // La misma fecha y hora de inicio en dos negocios: correcto, cada uno tiene
    // su propia agenda y no se chocan.
    const fecha = hoyMasDias(5);
    const huecoA = await crearHuecoLibreEn(fecha, "10:00", negocioA.id);
    const huecoB = await crearHuecoLibreEn(fecha, "10:00", negocioB.id);
    ids.disponibilidades.push(huecoA.id, huecoB.id);
    assert.notEqual(huecoA.id, huecoB.id);

    // La misma categoría en los dos negocios.
    const catA = await prisma.category.create({ data: { businessId: negocioA.id, name: "COMPARTIDA" } });
    const catB = await prisma.category.create({ data: { businessId: negocioB.id, name: "COMPARTIDA" } });
    assert.notEqual(catA.id, catB.id);

    // Y el mismo documento en los dos negocios: son personas distintas para cada
    // empresa, así que no colisionan.
    const documento = `DOCCOMPARTIDO${Date.now()}`;
    const { cliente: clienteA } = await clientService.crearCliente(
      { nombre: "Homónimo", email: `homono.a.${Date.now()}@ejemplo.com`, documento, password: "Pruebas1234" },
      negocioA.id
    );
    const { cliente: clienteB } = await clientService.crearCliente(
      { nombre: "Homónimo", email: `homono.b.${Date.now()}@ejemplo.com`, documento, password: "Pruebas1234" },
      negocioB.id
    );
    assert.notEqual(clienteA.id, clienteB.id);

    // Pero dentro del mismo negocio, el documento sigue siendo único.
    await assert.rejects(
      () =>
        clientService.crearCliente(
          { nombre: "Otro homónimo", email: `otro.${Date.now()}@ejemplo.com`, documento, password: "Pruebas1234" },
          negocioA.id
        ),
      (error) => error.estado === 409
    );
  } finally {
    await limpiar(ids);
  }
});

test("un cliente de otro negocio no puede reservar un hueco ajeno", async () => {
  const ids = idsVacios();
  try {
    const { usuario: intruso } = await crearCliente(`forastero.${Date.now()}@ejemplo.com`, SLUG_B);
    ids.clientes.push(intruso.id);
    assert.equal(intruso.client.businessId, negocioB.id);

    const huecoAjeno = await crearHuecoLibreLejos(20, negocioA.id);
    ids.disponibilidades.push(huecoAjeno.id);

    // Ni siquiera ve que existe.
    await assert.rejects(
      () => availabilityService.obtenerDisponibilidad(huecoAjeno.id, {}, negocioB.id),
      (error) => error.estado === 404
    );

    // El dueño legítimo del hueco sí puede reservarlo, así que el hueco existe
    // y está libre: el 404 del intruso viene del negocio, no de un dato sucio.
    const { usuario: dueno } = await crearCliente(`dueno.hueco.${Date.now()}@ejemplo.com`, SLUG_A);
    ids.clientes.push(dueno.id);

    const citaAjena = await reservar({ cliente: dueno.client, hueco: huecoAjeno });
    ids.citas.push(citaAjena.id);

    await assert.rejects(
      () => reservar({ cliente: intruso.client, hueco: huecoAjeno }),
      (error) => error.estado === 404
    );
  } finally {
    await limpiar(ids);
  }
});

test("un cliente de otro negocio no ve ni toca las citas ajenas", async () => {
  const ids = idsVacios();
  try {
    const { usuario: dueno } = await crearCliente(`dueno.cita.${Date.now()}@ejemplo.com`, SLUG_A);
    const { usuario: intruso } = await crearCliente(`intruso.cita.${Date.now()}@ejemplo.com`, SLUG_B);
    ids.clientes.push(dueno.id, intruso.id);

    const hueco = await crearHuecoLibreLejos(21, negocioA.id);
    ids.disponibilidades.push(hueco.id);

    const cita = await reservar({ cliente: dueno.client, hueco });
    ids.citas.push(cita.id);

    // El listado ya viene acotado al negocio, así que ni con el clienteId del
    // ajeno se ve la cita.
    const suyas = await appointmentService.listarCitas(
      { limit: 100 },
      { clienteId: dueno.client.id, businessId: negocioB.id }
    );
    assert.equal(suyas.total, 0, "la cita del otro negocio no sale en su listado");

    // Abrirla por id, con el negocio del intruso, es un 404.
    await assert.rejects(
      () => appointmentService.obtenerCita(cita.id, {}, negocioB.id),
      (error) => error.estado === 404
    );

    // Y cambiar su estado, o borrarla, tampoco: el servicio compara el
    // businessId antes de tocar nada.
    await assert.rejects(
      () =>
        appointmentService.cambiarEstadoCita({
          citaId: cita.id,
          nuevoEstado: "COORDINATED",
          actorId: adminB.id,
          businessId: negocioB.id
        }),
      (error) => error.estado === 404
    );
    await assert.rejects(() => appointmentService.eliminarCita(cita.id, negocioB.id), (error) => error.estado === 404);

    // Tras el intento fallido, la cita sigue intacta.
    const intacta = await appointmentService.obtenerCita(cita.id, {}, negocioA.id);
    assert.equal(intacta.status, "PENDING", "el intento ajeno no cambia el estado");

    // Cancelar desde el cliente ajeno también se rechaza.
    await assert.rejects(
      () => appointmentService.cancelarCitaDelCliente({ citaId: cita.id, clienteId: intruso.client.id }),
      (error) => error.estado === 403
    );
  } finally {
    await limpiar(ids);
  }
});

test("un administrador no ve los clientes, tareas ni horarios de otro negocio", async () => {
  const ids = idsVacios();
  try {
    const { usuario: clienteA } = await crearCliente(`cliente.a.${Date.now()}@ejemplo.com`, SLUG_A);
    ids.clientes.push(clienteA.id);

    const tareaA = await prisma.task.create({
      data: { businessId: negocioA.id, title: "Tarea privada de A", clientId: clienteA.client.id }
    });
    ids.tareas.push(tareaA.id);

    const huecoA = await crearHuecoLibreLejos(22, negocioA.id);
    ids.disponibilidades.push(huecoA.id);

    // Listados: el admin de B no ve nada de A.
    const clientesB = await clientService.listarClientes({ limit: 100 }, negocioB.id);
    assert.ok(!clientesB.items.some((c) => c.id === clienteA.client.id), "el cliente de A no sale en el listado de B");

    const tareasB = await taskService.listarTareas({ limit: 500 }, negocioB.id);
    assert.ok(!tareasB.items.some((t) => t.id === tareaA.id), "la tarea de A no sale en el listado de B");

    const huecosB = await availabilityService.listarDisponibilidades({}, negocioB.id);
    assert.ok(!huecosB.some((h) => h.id === huecoA.id), "el horario de A no sale en el listado de B");

    // Detalle por id: 404, no "no encontrado" genérico.
    await assert.rejects(() => clientService.obtenerCliente(clienteA.client.id, negocioB.id), (error) => error.estado === 404);
    await assert.rejects(() => taskService.obtenerTarea(tareaA.id, negocioB.id), (error) => error.estado === 404);
    await assert.rejects(
      () => availabilityService.obtenerDisponibilidad(huecoA.id, {}, negocioB.id),
      (error) => error.estado === 404
    );

    // Escribir tampoco: el admin de B no puede borrar nada de A.
    await assert.rejects(
      () => availabilityService.eliminarDisponibilidad(huecoA.id, negocioB.id),
      (error) => error.estado === 404
    );
    await assert.rejects(
      () => clientService.eliminarCliente(clienteA.client.id, adminB),
      (error) => error.estado === 404
    );
    await assert.rejects(() => taskService.eliminarTarea(tareaA.id, negocioB.id), (error) => error.estado === 404);

    // Todo sigue ahí para quien corresponde.
    const huecoIntacto = await prisma.availability.findUnique({ where: { id: huecoA.id } });
    assert.equal(huecoIntacto.businessId, negocioA.id);
    const tareaIntacta = await prisma.task.findUnique({ where: { id: tareaA.id } });
    assert.ok(tareaIntacta, "la tarea de A sigue existiendo");
  } finally {
    await limpiar(ids);
  }
});

test("no se puede pasar la cita de un negocio a otro al reprogramar", async () => {
  const ids = idsVacios();
  try {
    const { usuario: dueno } = await crearCliente(`dueno.repro.${Date.now()}@ejemplo.com`, SLUG_A);
    ids.clientes.push(dueno.id);

    const viejo = await crearHuecoLibreLejos(23, negocioA.id);
    const huecoAjeno = await crearHuecoLibreLejos(23, negocioB.id);
    ids.disponibilidades.push(viejo.id, huecoAjeno.id);

    const cita = await reservar({ cliente: dueno.client, hueco: viejo });
    ids.citas.push(cita.id);

    // El hueco de B es AVAILABLE de verdad, pero para la cita de A no existe.
    await assert.rejects(
      () =>
        appointmentService.reprogramarCita({
          citaId: cita.id,
          availabilityId: huecoAjeno.id,
          actorId: adminA.id,
          businessId: negocioA.id
        }),
      (error) => error.estado === 404
    );

    // Y el hueco viejo sigue bloqueado: el intento fallido no lo liberó.
    const estadoViejo = await prisma.availability.findUnique({ where: { id: viejo.id } });
    assert.equal(estadoViejo.status, "HELD", "el intento fallido no libera el hueco de origen");
  } finally {
    await limpiar(ids);
  }
});

test("un negocio desactivado no deja entrar a sus usuarios", async () => {
  const temporal = await businessService.crearNegocio({
    nombre: "Pruebas C",
    slug: "pruebas-c",
    admin: { nombre: "Admin de pruebas-c", email: `admin.c.${Date.now()}@pruebas.local`, password: "Pruebas1234" }
  });
  const { usuario: clienteC } = await authService.registrarCliente({
    nombre: "Cliente de C",
    email: `cliente.c.${Date.now()}@ejemplo.com`,
    password: "Pruebas1234",
    negocio: "pruebas-c"
  });
  const emailAdmin = temporal.users[0].email;

  try {
    // Activo: entran su administrador y su cliente.
    const ok = await authService.autenticarUsuario({
      email: emailAdmin,
      password: "Pruebas1234",
      negocio: "pruebas-c"
    });
    assert.equal(ok.usuario.businessId, temporal.id);

    await businessService.cambiarEstadoNegocio(temporal.id, false);

    // Desactivado: ni el admin ni el cliente pueden entrar.
    await assert.rejects(
      () => authService.autenticarUsuario({ email: emailAdmin, password: "Pruebas1234", negocio: "pruebas-c" }),
      (error) => error.estado === 403
    );
    await assert.rejects(
      () => authService.autenticarUsuario({ email: clienteC.email, password: "Pruebas1234", negocio: "pruebas-c" }),
      (error) => error.estado === 403
    );
    // Y tampoco se pueden registrar clientes nuevos ahí.
    await assert.rejects(
      () =>
        authService.registrarCliente({
          nombre: "Nuevo",
          email: `nuevo.c.${Date.now()}@ejemplo.com`,
          password: "Pruebas1234",
          negocio: "pruebas-c"
        }),
      (error) => error.estado === 403
    );

    // Y reactivándolo vuelve a entrar: desactivar es reversible.
    await businessService.cambiarEstadoNegocio(temporal.id, true);
    const otra = await authService.autenticarUsuario({
      email: emailAdmin,
      password: "Pruebas1234",
      negocio: "pruebas-c"
    });
    assert.equal(otra.usuario.id, temporal.users[0].id);
  } finally {
    await prisma.business.deleteMany({ where: { id: temporal.id } });
  }
});

test("una cuenta no entra por la puerta de un negocio que no es el suyo", async () => {
  const { usuario } = await crearCliente(`puerta.${Date.now()}@ejemplo.com`, SLUG_A);

  try {
    // Su propia puerta: entra.
    const propia = await authService.autenticarUsuario({
      email: usuario.email,
      password: "Pruebas1234",
      negocio: SLUG_A
    });
    assert.equal(propia.usuario.id, usuario.id);

    // La puerta del otro negocio: no, aunque la contraseña sea correcta.
    await assert.rejects(
      () => authService.autenticarUsuario({ email: usuario.email, password: "Pruebas1234", negocio: SLUG_B }),
      (error) => error.estado === 401
    );

    // Y sin negocio en el cuerpo tampoco: es obligatorio para todos menos el
    // superadmin.
    await assert.rejects(
      () => authService.autenticarUsuario({ email: usuario.email, password: "Pruebas1234" }),
      (error) => error.estado === 401
    );
  } finally {
    await limpiar({ citas: [], tareas: [], disponibilidades: [], clientes: [usuario.id] });
  }
});

test("el superadministrador entra sin negocio y no puede colarse por una puerta de empresa", async () => {
  const superadmin = await prisma.user.findFirst({ where: { role: "SUPERADMIN" } });

  // Sin superadmin en la base no hay nada que comprobar: se avisa en vez de
  // dejar que el test pase en verde por no haber hecho nada.
  assert.ok(superadmin, "el seed debe dejar un superadministrador (npm run db:seed)");

  const sesion = await authService.autenticarUsuario({ email: superadmin.email, password: "Super1234" });
  assert.equal(sesion.usuario.businessId, null, "el superadmin no pertenece a ningún negocio");
  assert.equal(sesion.usuario.role, "SUPERADMIN");

  await assert.rejects(
    () => authService.autenticarUsuario({ email: superadmin.email, password: "Super1234", negocio: SLUG_A }),
    (error) => error.estado === 401
  );
});
