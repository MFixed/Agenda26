/**
 * Simulación de carga: 10 clientes con cuenta, 10 citas repartidas por todos los
 * estados y unas pocas tareas propias, para ver la aplicación con datos
 * realistas en lugar de las dos personas del seed.
 *
 *   node scripts/simulacion.js                      crea la simulación
 *   node scripts/simulacion.js --limpiar            borra sólo lo que creó
 *   node scripts/simulacion.js --negocio=barberia   contra otra empresa
 *
 * Todas las personas y citas son fijas, sin números aleatorios: dos ejecuciones
 * dejan el mismo resultado y se puede repetir tantas veces como haga falta.
 *
 * IMPORTANTE: se borran los clientes de la simulación antes de crearlos, así que
 * cualquier cita o tarea suya anterior desaparece. Ni el administrador ni los
 * clientes del seed se tocan.
 *
 * MULTI-NEGOCIO: todo lo que crea la simulación pertenece a UNA empresa, la que
 * se indica con --negocio. No se mezclan datos de varias: los correos, el título
 * de las tareas y la nota de los horarios son los mismos en todas, así que sin
 * acotar por empresa el "borrar lo anterior" se comería la simulación de otra.
 */
import { prisma } from "../src/config/database.js";
import { registrarCliente } from "../src/services/auth.service.js";
import { crearDisponibilidad } from "../src/services/availability.service.js";
import { solicitarCita, cambiarEstadoCita } from "../src/services/appointment.service.js";
import { crearTarea } from "../src/services/task.service.js";
import { formatearFechaES, hoyMasDias } from "../src/utils/date.js";

const soloLimpiar = process.argv.includes("--limpiar");

/** Empresa donde se crea la simulación. El seed deja `principal` y `barberia`. */
const SLUG = (process.argv.find((arg) => arg.startsWith("--negocio=")) || "").split("=")[1] || "principal";

/** Marca recognizable: todo lo de la simulación lleva esta nota o este prefijo. */
const CORREO_SIMULACION = "@simulacion.local";
const NOTA_HUECO = "Simulación de carga";

/**
 * Correo del cliente `posicion` en la empresa `slug`.
 *
 * El identificador de la empresa va dentro del correo a propósito. `User.email` es
 * único en TODA la instalación, no dentro de cada empresa: una persona es una
 * cuenta y no puede tener dos identidades en el mismo sistema. Por eso la
 * simulación no puede usar `cliente01@simulacion.local` en las dos empresas, y con
 * ese nombre la segunda se caía con un 409 al crear su primer cliente.
 *
 * Con el slug dentro, cada empresa tiene su propio juego de cuentas y se pueden
 * simular todas a la vez, que es lo que hace falta para ver el aislamiento entre
 * empresas de un vistazo.
 */
const correoDe = (posicion, slug) => `cliente${String(posicion + 1).padStart(2, "0")}.${slug}${CORREO_SIMULACION}`;

const CLIENTES = [
  { nombre: "Elena Vidal Serrano", documento: "11223344B", fechaNacimiento: "1991-03-08", telefono: "+34 600 201 001", direccion: "Calle del Carmen 7, 1º A, 28005 Madrid" },
  { nombre: "Marcos Fuentesprior", documento: "22334455C", fechaNacimiento: "1986-12-19", telefono: "+34 600 201 002", direccion: "Avenida Diagonal 210, 5º, 08019 Barcelona" },
  { nombre: "Pilar Nájera Lucio", documento: "33445566D", fechaNacimiento: "1996-07-24", telefono: "+34 600 201 003", direccion: "Plaza del Acebuchal 3, 41004 Sevilla" },
  { nombre: "Rubén Sanz Reparaz", documento: "44556677E", fechaNacimiento: "1979-01-30", telefono: "+34 600 201 004", direccion: "Calle San Juan 45, bajo, 46002 Valencia" },
  { nombre: "Nuria Cuesta Almenar", documento: "55667788F", fechaNacimiento: "1999-09-12", telefono: "+34 600 201 005", direccion: "Ronda de la Muralla 19, 2º, 15001 A Coruña" },
  { nombre: "Iván Boada Quintana", documento: "66778899G", fechaNacimiento: "1983-04-05", telefono: "+34 600 201 006", direccion: "Paseo de la Castellana 88, 9º B, 28046 Madrid" },
  { nombre: "Sofía Moliner Rabal", documento: "77889900H", fechaNacimiento: "1993-11-27", telefono: "+34 600 201 007", direccion: "Gran Vía 51, 3º izq, 33001 Oviedo" },
  { nombre: "Tomás Lerma Patti", documento: "88990011J", fechaNacimiento: "1975-06-14", telefono: "+34 600 201 008", direccion: "Avenida del Mar 22, 5º, 30001 Murcia" },
  { nombre: "Ainhoa Belmonte Odriozola", documento: "99001122K", fechaNacimiento: "1990-08-21", telefono: "+34 600 201 009", direccion: "Calle Larramendi 6, 4º, 48008 Bilbao" },
  { nombre: "Óscar Molinero Fayán", documento: "10112233L", fechaNacimiento: "1988-02-16", telefono: "+34 600 201 010", direccion: "Carretera de la Costa 61, 3º B, 29016 Málaga" }
];

/** Servicios de ejemplo, uno por cliente y con la categoría SERVICIOS. */
const SERVICIOS = [
  { titulo: "Instalación de caldera de gas", nota: "Caldera de 24 kW en la cocina. Preguntar por el acceso." },
  { titulo: "Revisión de la instalación eléctrica", nota: "Saltan los diferenciales al conectar el horno." },
  { titulo: "Presupuesto de reforma del baño", nota: "Cambio de bañera y plato de ducha." },
  { titulo: "Mantenimiento de aire acondicionado", nota: "Limpieza de filtros y carga de gas." },
  { titulo: "Cambio de cerradura", nota: "Se ha perdido la llave del portal." },
  { titulo: "Revisión de tuberías y desagües", nota: "Goteo bajo el fregadero de la cocina." },
  { titulo: "Pintura de dos habitaciones", nota: "Color blanco roto, paredes y techo." },
  { titulo: "Montaje de muebles de cocina", nota: "Cocina nueva sin montar." },
  { titulo: "Certificado de eficiencia energética", nota: "Para vender el piso." },
  { titulo: "Instalación de punto de wifi", nota: "Sin cobertura en el despacho." }
];

/**
 * Las 10 citas y el estado al que llega cada una. Todas nacen como solicitudes
 * pendientes (lo que hace un cliente) y luego el administrador las mueve, para
 * que la simulación recorra el flujo entero y deje historial y notificaciones
 * reales en vez de estados escritos a mano.
 */
const PLAN_DE_CITAS = [
  { indice: 0, estado: "COORDINATED" },
  { indice: 1, estado: "COORDINATED" },
  { indice: 2, estado: "COORDINATED" },
  { indice: 3, estado: "COMPLETED", pasarPor: "COORDINATED" },
  { indice: 4, estado: "COMPLETED", pasarPor: "COORDINATED" },
  { indice: 5, estado: "PENDING" },
  { indice: 6, estado: "PENDING" },
  { indice: 7, estado: "PENDING" },
  { indice: 8, estado: "REJECTED" },
  { indice: 9, estado: "PENDING" }
];

/** Sólo tres tareas propias: las del administrador, que es lo que se quiere ver. */
/**
 * Los títulos llevan "de la simulación" a propósito, para que el borrado de
 * ejecuciones anteriores (que los localiza por título) no se lleve por delante
 * una tarea que haya creado el usuario con el mismo nombre.
 */
const TAREAS_PROPIAS = [
  {
    title: "Revisar la caldera de la oficina (simulación)",
    description: "Mantenimiento anual obligatorio.",
    categoria: "MANTENIMIENTO",
    dias: 2,
    dueTime: "09:30"
  },
  { title: "Renovar el seguro del local (simulación)", categoria: "ADMINISTRACIÓN" },
  {
    title: "Cerrar el ejercicio fiscal (simulación)",
    categoria: "OTROS",
    status: "COMPLETED"
  }
];

async function main() {
  // El negocio se resuelve por su identificador porque todo lo de abajo va
  // acotado a él: categorías, clientes, horarios y citas.
  const negocio = await prisma.business.findUnique({ where: { slug: SLUG } });
  if (!negocio) {
    throw new Error(`No hay ninguna empresa con el identificador "${SLUG}". Carga antes el seed: npm run db:seed`);
  }
  if (!negocio.activo) {
    throw new Error(`La empresa "${SLUG}" está desactivada: actívala antes de simular.`);
  }

  const categorias = await mapaDeCategorias(negocio.id);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", activo: true, businessId: negocio.id } });
  if (!admin) {
    throw new Error(`"${SLUG}" no tiene ningún administrador activo. Carga antes el seed: npm run db:seed`);
  }

  await borrarSimulacionAnterior(negocio.id);

  if (soloLimpiar) {
    await mostrar(negocio.id, `Simulación borrada de "${SLUG}".`);
    return;
  }

  console.log("\n== 1. Clientes ==\n");
  const clientes = [];
  for (const [posicion, datos] of CLIENTES.entries()) {
    const email = correoDe(posicion, SLUG);
    // registrarCliente devuelve el usuario con su ficha de cliente incluida. El
    // negocio sale del slug: así el cliente nace dentro de esta empresa.
    const { usuario } = await registrarCliente({ ...datos, email, password: "Cliente1234", negocio: SLUG });
    clientes.push({ ...usuario.client, userId: usuario.id, email });
    console.log(`  ${String(posicion + 1).padStart(2)}  ${usuario.client.nombre}  ·  ${email}`);
  }

  console.log("\n== 2. Disponibilidad de los próximos 8 días ==\n");
  const huecos = await publicarHuecos(negocio.id);
  console.log(`  ${huecos.length} horarios publicados`);

  console.log("\n== 3. Citas ==\n");
  const citas = [];
  for (const plan of PLAN_DE_CITAS) {
    const cliente = clientes[plan.indice];
    const servicio = SERVICIOS[plan.indice];
    const hueco = huecos[plan.indice];

    // La cita la pide el propio cliente, que es como ocurre de verdad.
    const cita = await solicitarCita({
      cliente,
      availabilityId: hueco.id,
      categoryId: categorias.get("SERVICIOS").id,
      title: servicio.titulo,
      note: servicio.nota,
      actorId: cliente.userId
    });

    // Y luego la mueve el administrador, dejando evento y notificación. Una cita
    // que se queda PENDING no se toca: ya nació así al solicitarla el cliente.
    const camino = [plan.pasarPor, plan.estado].filter((estado) => estado && estado !== "PENDING");
    for (const estado of camino) {
      await cambiarEstadoCita({ citaId: cita.id, nuevoEstado: estado, actorId: admin.id });
    }

    citas.push(cita);
    console.log(`  ${formatearFechaES(hueco.fecha)}  ${hueco.hora}  ${cliente.nombre.padEnd(24)} ${estadoTexto(plan.estado)}`);
  }

  console.log("\n== 4. Tareas propias ==\n");
  for (const tarea of TAREAS_PROPIAS) {
    await crearTarea(
      {
        title: tarea.title,
        description: tarea.description,
        categoryId: categorias.get(tarea.categoria).id,
        status: tarea.status || "PENDING",
        // Sin "dias" no se toca dueDate, y la tarea queda "sin fecha" a propósito.
        dueDate: tarea.dias === undefined ? null : hoyMasDias(tarea.dias),
        dueTime: tarea.dueTime || null
      },
      negocio.id
    );
    console.log(`  ${tarea.dias === undefined ? "sin fecha" : formatearFechaES(hoyMasDias(tarea.dias))}  ${tarea.title}`);
  }

  await mostrar(negocio.id, `Simulación lista (${formatearFechaES(hoyMasDias(0))}).`);

  console.log(`
Entrar con cualquiera de los ${CLIENTES.length} clientes, por la puerta de "${SLUG}":
  ${correoDe(0, SLUG)} / Cliente1234   ->  /b/${SLUG}/login
  ...
  ${correoDe(CLIENTES.length - 1, SLUG)} / Cliente1234

  node scripts/simulacion.js --limpiar   para borrar sólo estos datos
`);
}

/**
 * Borra lo que dejó una simulación anterior. Se va por los correos y las notas,
 * nunca por un deleteMany global, para no comerse los datos del seed ni los que
 * haya creado el usuario a mano.
 */
async function borrarSimulacionAnterior(businessId) {
  const clientes = await prisma.client.findMany({
    where: { businessId, user: { email: { endsWith: CORREO_SIMULACION } } },
    select: { id: true, userId: true }
  });

  const idsClientes = clientes.map((c) => c.id);
  const idsUsuarios = clientes.map((c) => c.userId);

  const citas = await prisma.appointment.findMany({
    where: { clientId: { in: idsClientes } },
    select: { id: true }
  });
  const idsCitas = citas.map((cita) => cita.id);

  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId: { in: idsUsuarios } } }),
    prisma.notification.deleteMany({ where: { appointmentId: { in: idsCitas } } }),
    prisma.appointmentEvent.deleteMany({ where: { appointmentId: { in: idsCitas } } }),
    prisma.appointment.deleteMany({ where: { id: { in: idsCitas } } }),
    // Las tareas de estos clientes nacieron de sus citas: se van con ellas.
    prisma.task.deleteMany({ where: { clientId: { in: idsClientes } } }),
    prisma.client.deleteMany({ where: { id: { in: idsClientes } } }),
    prisma.user.deleteMany({ where: { id: { in: idsUsuarios } } })
  ]);

  // Ahora que sus citas ya no existen, los horarios de la simulación que
  // tenían detrás quedan huérfanos y se pueden retirar. Se hace después, no
  // antes: si se hiciera antes, los que aún estaban en uso se salvarían y
  // luego se amontonarían en cada ejecución. Si otra persona reservó uno, se
  // respeta y se queda publicado.
  const { count: huerfanos } = await prisma.availability.deleteMany({
    where: { businessId, note: NOTA_HUECO, appointments: { none: {} } }
  });

  // Las tres tareas propias también se sustituyen, para que repetir la
  // simulación no quadruple la lista del administrador. Se localizan por su
  // título, que este script es el único que usa.
  const { count: tareasViejas } = await prisma.task.deleteMany({
    where: {
      businessId,
      title: { in: TAREAS_PROPIAS.map((tarea) => tarea.title) },
      appointments: { none: {} }
    }
  });

  if (idsClientes.length > 0 || huerfanos > 0 || tareasViejas > 0) {
    console.log(
      `  (limpiado lo de una ejecución anterior: ${idsClientes.length} clientes, ${citas.length} citas,` +
        ` ${huerfanos} horarios, ${tareasViejas} tareas)`
    );
  }
}

/**
 * Publica un horario por servicio, repartidos entre mañana y dentro de una
 * semana para que las 10 citas caigan en días distintos y el calendario se vea
 * real en vez de amontonado.
 *
 * No se pisa nada: si esa fecha y esa hora ya están ocupadas por un horario del
 * seed o por una reserva, se prueba la siguiente franja del día.
 */
async function publicarHuecos(businessId) {
  const FRANJAS = [
    { hora: "09:00", fin: "10:30" },
    { hora: "11:00", fin: "12:30" },
    { hora: "14:00", fin: "15:30" },
    { hora: "16:30", fin: "18:00" }
  ];

  const huecos = [];
  for (const [posicion] of SERVICIOS.entries()) {
    const fecha = hoyMasDias(1 + (posicion % 8));

    // No se puede filtrar con await dentro de un callback síncrono.
    const libres = [];
    for (const franja of FRANJAS) {
      if (!(await estaOcupada(fecha, franja.hora, businessId))) {
        libres.push(franja);
      }
    }

    if (libres.length === 0) {
      throw new Error(`No queda ninguna franja libre el ${fecha}. Borra la simulación con --limpiar y vuelve a intentarlo.`);
    }

    // Se va repartiendo entre las franjas libres del día, así que los servicios
    // no se chocan entre sí ni con lo que ya había.
    const franja = libres[Math.floor(posicion / 8) % libres.length];
    const creado = await crearDisponibilidad(
      {
        date: fecha,
        startTime: franja.hora,
        endTime: franja.fin,
        status: "AVAILABLE",
        note: NOTA_HUECO
      },
      businessId
    );
    huecos.push({ ...creado, fecha, hora: franja.hora });
  }
  return huecos;
}

async function estaOcupada(fecha, hora, businessId) {
  const inicio = new Date(`${fecha}T00:00:00.000Z`);
  return (await prisma.availability.count({ where: { businessId, date: inicio, startTime: hora } })) > 0;
}

function estadoTexto(estado) {
  return { PENDING: "pendiente", COORDINATED: "coordinada", COMPLETED: "completada", REJECTED: "rechazada" }[estado] || estado;
}

/**
 * Categorías de UNA empresa. Ahora que los nombres sólo son únicos dentro de cada
 * empresa, el nombre "SERVICIOS" puede existir en varias a la vez: sin acotar por
 * negocio, el mapa devolvería la de otra empresa y las tareas y citas se colgarían
 * del negocio equivocado.
 */
async function mapaDeCategorias(businessId) {
  const categorias = await prisma.category.findMany({ where: { businessId } });
  const mapa = new Map(categorias.map((categoria) => [categoria.name, categoria]));
  const faltan = ["SERVICIOS", "MANTENIMIENTO", "ADMINISTRACIÓN", "OTROS"].filter((n) => !mapa.has(n));
  if (faltan.length > 0) {
    throw new Error(`Faltan categorías del seed: ${faltan.join(", ")}. Carga antes el seed: npm run db:seed`);
  }
  return mapa;
}

async function mostrar(businessId, linea) {
  const [usuarios, clientes, citas, tareas, conCita] = await Promise.all([
    prisma.user.count({ where: { businessId } }),
    prisma.client.count({ where: { businessId } }),
    prisma.appointment.count({ where: { businessId } }),
    prisma.task.count({ where: { businessId } }),
    prisma.task.count({ where: { businessId, appointments: { some: {} } } })
  ]);

  console.log(`
${linea}
  ${usuarios} usuarios · ${clientes} clientes · ${citas} citas
  ${tareas} tareas, de las cuales ${conCita} nacen de citas
  -> en "Mis tareas" el administrador ve ${tareas - conCita}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
