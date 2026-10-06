/**
 * Seed determinista: mismos negocios, mismas personas, mismas tareas y mismos
 * estados en cada ejecución. Sin números aleatorios.
 *
 * Dos negocios de ejemplo:
 *   - "principal": el de antes, con admin@ejemplo.com / ana y luis.
 *   - "barberia": un segundo negocio, con su propio admin y su propio cliente,
 *     para que se vea la separación multi-negocio desde el primer minuto.
 *
 * Las disponibilidades sí se generan a partir de "hoy" (hoy+1, hoy+2, hoy+3)
 * para que la demo siempre tenga huecos futuros donde reservar. El hueco del
 * escenario de aceptación (mañana a las 15:00) se deja libre a propósito.
 *
 *   npx prisma db seed
 */
import { PrismaClient } from "@prisma/client";
import { formatearFechaES, hoyMasDias } from "../src/utils/date.js";
import { hashPassword } from "../src/utils/password.js";

const prisma = new PrismaClient();

/** "2026-09-30" -> Date en medianoche UTC, que es como Prisma guarda las fechas. */
const dia = (fechaISO) => new Date(Date.UTC(...despiece(fechaISO)));

const CATEGORIAS = [
  { name: "SERVICIOS", description: "Trabajos que se realizan para un cliente." },
  { name: "VENTAS", description: "Presupuestos, ofertas y seguimiento comercial." },
  { name: "COMPRAS", description: "Materiales, suministros y material de oficina." },
  { name: "ADMINISTRACIÓN", description: "Gestión interna, facturación y papeleo." },
  { name: "MANTENIMIENTO", description: "Revisiones y reparaciones." },
  { name: "OTROS", description: "Lo que todavía no tiene categoría." }
];

async function crearCategorias(businessId) {
  const mapa = new Map();
  for (const categoria of CATEGORIAS) {
    const creada = await prisma.category.create({ data: { ...categoria, businessId } });
    mapa.set(categoria.name, creada);
  }
  return mapa;
}

async function main() {
  console.log("Limpiando datos anteriores…");
  // El orden respeta las dependencias: primero los hijos, luego los padres.
  await prisma.notification.deleteMany();
  await prisma.appointmentEvent.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.task.deleteMany();
  await prisma.category.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();
  await prisma.business.deleteMany();

  console.log("Superadministrador de plataforma…");
  await prisma.user.create({
    data: {
      nombre: "Equipo Plataforma",
      email: "super@plataforma.com",
      passwordHash: await hashPassword("Super1234"),
      role: "SUPERADMIN"
    }
  });

  console.log("Negocio principal…");
  const principal = await prisma.business.create({
    data: { nombre: "Negocio principal", slug: "principal", descripcion: "Negocio de demostración." }
  });
  const categoriasPrincipal = await crearCategorias(principal.id);
  const idCategoriaPrincipal = (nombre) => categoriasPrincipal.get(nombre).id;

  const hashAdmin = await hashPassword("Admin1234");
  const hashCliente = await hashPassword("Cliente1234");

  const admin = await prisma.user.create({
    data: {
      nombre: "Rita Gómez",
      email: "admin@ejemplo.com",
      passwordHash: hashAdmin,
      role: "ADMIN",
      businessId: principal.id
    }
  });

  const { client: ana } = await prisma.user.create({
    data: {
      nombre: "Ana Martínez Ruiz",
      email: "ana@ejemplo.com",
      passwordHash: hashCliente,
      role: "CLIENT",
      businessId: principal.id,
      client: {
        create: {
          businessId: principal.id,
          nombre: "Ana Martínez Ruiz",
          documento: "12345678A",
          fechaNacimiento: dia("1994-05-17"),
          telefono: "+34 600 111 222",
          direccion: "Calle Mayor 1, 3º B, 28013 Madrid"
        }
      }
    },
    include: { client: true }
  });

  const { client: luis } = await prisma.user.create({
    data: {
      nombre: "Luis Ortega Peña",
      email: "luis@ejemplo.com",
      passwordHash: hashCliente,
      role: "CLIENT",
      businessId: principal.id,
      client: {
        create: {
          businessId: principal.id,
          nombre: "Luis Ortega Peña",
          documento: "87654321Z",
          fechaNacimiento: dia("1988-11-03"),
          telefono: "+34 600 333 444",
          direccion: "Avenida del Puerto 44, 2º, 08001 Barcelona"
        }
      }
    },
    include: { client: true }
  });

  console.log("Tareas…");
  await prisma.task.create({
    data: {
      businessId: principal.id,
      title: "Comprar materiales",
      description: "Guantes, cinta aislante y productos de limpieza.",
      categoryId: idCategoriaPrincipal("COMPRAS")
      // Sin fecha: es una de las tareas de la vista "Tareas sin fecha".
    }
  });
  await prisma.task.create({
    data: { businessId: principal.id, title: "Renovar el seguro del local", categoryId: idCategoriaPrincipal("ADMINISTRACIÓN") }
  });
  const tareaRevision = await prisma.task.create({
    data: {
      businessId: principal.id,
      title: "Revisión de la caldera",
      description: "Mantenimiento anual obligatorio.",
      categoryId: idCategoriaPrincipal("MANTENIMIENTO"),
      dueDate: dia(hoyMasDias(3)),
      dueTime: "09:30"
    }
  });
  const tareaPresupuesto = await prisma.task.create({
    data: {
      businessId: principal.id,
      title: "Presupuesto para la comunidad",
      categoryId: idCategoriaPrincipal("VENTAS"),
      dueDate: dia(hoyMasDias(2)),
      dueTime: "11:00",
      status: "IN_PROGRESS"
    }
  });
  await prisma.task.create({
    data: { businessId: principal.id, title: "Cerrar el ejercicio de 2025", categoryId: idCategoriaPrincipal("OTROS"), status: "COMPLETED" }
  });

  console.log("Disponibilidad…");
  const manana = hoyMasDias(1);
  const pasado = hoyMasDias(2);
  const tresDias = hoyMasDias(3);

  // Mañana 15:00-16:00: hueco libre del escenario de aceptación.
  await prisma.availability.create({ data: { businessId: principal.id, date: dia(manana), startTime: "15:00", endTime: "16:00" } });
  // Mañana 09:00-10:00: bloqueado por el administrador, no se puede reservar.
  const huecoBloqueado = await prisma.availability.create({
    data: { businessId: principal.id, date: dia(manana), startTime: "09:00", endTime: "10:00", status: "BLOCKED", note: "Reunión interna" }
  });
  await prisma.availability.create({ data: { businessId: principal.id, date: dia(pasado), startTime: "17:00", endTime: "18:00" } });
  await prisma.availability.create({ data: { businessId: principal.id, date: dia(pasado), startTime: "18:00", endTime: "19:00" } });
  await prisma.availability.create({ data: { businessId: principal.id, date: dia(tresDias), startTime: "16:00", endTime: "17:00" } });

  // Pasado mañana 10:00: RESERVED por una cita confirmada.
  const huecoReservado = await prisma.availability.create({
    data: { businessId: principal.id, date: dia(pasado), startTime: "10:00", endTime: "11:00", status: "RESERVED" }
  });
  // En tres días 12:00: HELD por una cita que sigue en espera.
  const huecoEnEspera = await prisma.availability.create({
    data: { businessId: principal.id, date: dia(tresDias), startTime: "12:00", endTime: "13:00", status: "HELD" }
  });
  // Pasado mañana 19:00: quedó libre al rechazar una cita, así que sigue AVAILABLE.
  const huecoLiberado = await prisma.availability.create({
    data: { businessId: principal.id, date: dia(pasado), startTime: "19:00", endTime: "20:00" }
  });

  console.log("Citas…");
  // 1) Confirmada: disponibilidad RESERVED y evento en el historial.
  const tareaAire = await prisma.task.create({
    data: {
      businessId: principal.id,
      title: "Instalación de aire acondicionado",
      description: "Unidad de splits para el salón.",
      categoryId: idCategoriaPrincipal("SERVICIOS"),
      clientId: ana.id
    }
  });
  const citaCoordinada = await prisma.appointment.create({
    data: {
      businessId: principal.id,
      taskId: tareaAire.id,
      clientId: ana.id,
      availabilityId: huecoReservado.id,
      note: "Necesito la instalación en el fondo de la vivienda.",
      status: "COORDINATED"
    }
  });
  await prisma.appointmentEvent.create({
    data: { appointmentId: citaCoordinada.id, actorId: admin.id, fromStatus: "PENDING", toStatus: "COORDINATED", note: "Confirmada por teléfono." }
  });

  // 2) En espera: la disponibilidad queda HELD y nadie más puede tomarla.
  const tareaElectrica = await prisma.task.create({
    data: {
      businessId: principal.id,
      title: "Revisión de la instalación eléctrica",
      categoryId: idCategoriaPrincipal("SERVICIOS"),
      clientId: luis.id
    }
  });
  const citaEnEspera = await prisma.appointment.create({
    data: {
      businessId: principal.id,
      taskId: tareaElectrica.id,
      clientId: luis.id,
      availabilityId: huecoEnEspera.id,
      note: "El diferencial salta al conectar el aire acondicionado.",
      status: "PENDING"
    }
  });
  await prisma.appointmentEvent.create({
    data: { appointmentId: citaEnEspera.id, toStatus: "PENDING" }
  });

  // 3) Rechazada: el horario vuelve a estar libre (queda AVAILABLE).
  await prisma.appointment.create({
    data: {
      businessId: principal.id,
      taskId: tareaPresupuesto.id,
      clientId: luis.id,
      availabilityId: huecoLiberado.id,
      note: "El cliente pidió otro día.",
      status: "REJECTED"
    }
  });

  // 4) Completada.
  await prisma.appointment.create({
    data: {
      businessId: principal.id,
      taskId: tareaRevision.id,
      clientId: ana.id,
      availabilityId: huecoBloqueado.id,
      note: "Cerrada y cobrada.",
      status: "COMPLETED"
    }
  });

  console.log("Notificaciones…");
  await prisma.notification.create({
    data: {
      userId: ana.userId,
      appointmentId: citaCoordinada.id,
      type: "APPOINTMENT_COORDINATED",
      title: "Tu cita está coordinada",
      message: `Tu solicitud de "${tareaAire.title}" quedó coordinada para el ${formatearFechaES(pasado)} a las 10:00.`
    }
  });
  await prisma.notification.create({
    data: {
      userId: luis.userId,
      appointmentId: citaEnEspera.id,
      type: "APPOINTMENT_REQUESTED",
      title: "Solicitud enviada",
      message: "Hemos recibido tu solicitud. Te avisaremos en cuanto la confirmemos."
    }
  });
  await prisma.notification.create({
    data: {
      userId: luis.userId,
      appointmentId: citaEnEspera.id,
      type: "APPOINTMENT_PENDING",
      title: "Solicitud pendiente de revisión",
      message: "El administrador todavía no ha confirmado tu cita."
    }
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      appointmentId: citaEnEspera.id,
      type: "NEW_REQUEST",
      title: "Nueva solicitud de cita",
      message: `${luis.nombre} ha solicitado un horario.`
    }
  });

  console.log("Negocio barbería…");
  const barberia = await prisma.business.create({
    data: { nombre: "Barbería Central", slug: "barberia", descripcion: "Corte y barba, cita previa." }
  });
  const categoriasBarberia = await crearCategorias(barberia.id);

  const adminBarberia = await prisma.user.create({
    data: {
      nombre: "Paco Ruiz",
      email: "admin@barberia.com",
      passwordHash: hashAdmin,
      role: "ADMIN",
      businessId: barberia.id
    }
  });

  const { client: marta } = await prisma.user.create({
    data: {
      nombre: "Marta López",
      email: "marta@barberia.com",
      passwordHash: hashCliente,
      role: "CLIENT",
      businessId: barberia.id,
      client: {
        create: {
          businessId: barberia.id,
          nombre: "Marta López",
          documento: "99887766C",
          fechaNacimiento: dia("1997-02-20"),
          telefono: "+34 600 555 666"
        }
      }
    },
    include: { client: true }
  });

  await prisma.availability.create({
    data: { businessId: barberia.id, date: dia(manana), startTime: "10:00", endTime: "10:30" }
  });
  await prisma.availability.create({
    data: { businessId: barberia.id, date: dia(manana), startTime: "11:00", endTime: "11:30" }
  });

  const tareaCorte = await prisma.task.create({
    data: {
      businessId: barberia.id,
      title: "Corte de pelo de mujer",
      categoryId: categoriasBarberia.get("SERVICIOS").id,
      clientId: marta.id
    }
  });
  const huecoBarberia = await prisma.availability.create({
    data: { businessId: barberia.id, date: dia(pasado), startTime: "11:00", endTime: "11:30", status: "RESERVED" }
  });
  await prisma.appointment.create({
    data: {
      businessId: barberia.id,
      taskId: tareaCorte.id,
      clientId: marta.id,
      availabilityId: huecoBarberia.id,
      status: "COORDINATED"
    }
  });

  const [usuarios, negocios, categoriasTotales, tareas, disponibilidades, citas, avisos] = await Promise.all([
    prisma.user.count(),
    prisma.business.count(),
    prisma.category.count(),
    prisma.task.count(),
    prisma.availability.count(),
    prisma.appointment.count(),
    prisma.notification.count()
  ]);

  console.log(`
Seed completado
  ${usuarios} usuarios · ${negocios} negocios · ${categoriasTotales} categorías
  ${tareas} tareas · ${disponibilidades} disponibilidades · ${citas} citas · ${avisos} notificaciones

Entrar con:
  super@plataforma.com / Super1234        (superadmin, en /login)
  admin@ejemplo.com    / Admin1234        (admin, en /b/principal/login)
  ana@ejemplo.com      / Cliente1234      (cliente de principal)
  luis@ejemplo.com     / Cliente1234      (cliente de principal)
  admin@barberia.com   / Admin1234        (admin de barbería)
  marta@barberia.com   / Cliente1234      (cliente de barbería)
`);
}

/** "2026-09-30" -> [2026, 8, 30] con el mes en base 0, como pide Date.UTC. */
function despiece(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return [anio, mes - 1, dia];
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
