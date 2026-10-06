/**
 * Estado actual de la base de datos: los negocios que hay, cuántos registros
 * lleva cada uno y cómo quedaron sus disponibilidades y sus citas.
 *
 *   node scripts/estado.js             todos los negocios
 *   node scripts/estado.js principal   sólo ese, por su identificador
 *
 * Los totales van POR NEGOCIO y no en agregado: en una instalación multi-empresa
 * un "hay 12 clientes" sin decir de quién son no significa nada. El total
 * general sólo se imprime al final, como referencia.
 *
 *   node scripts/estado.js
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dia = (fecha) => fecha.toISOString().slice(0, 10);

const soloEste = process.argv[2];

/**
 * Las entidades que cuentan: la etiqueta, el modelo de Prisma y cómo se acota a
 * una empresa concreta.
 *
 * OJO: `AppointmentEvent` y `Notification` NO tienen columna `businessId`. No
 * cuelgan de una empresa, cuelgan de una cita y de un usuario, y es lo correcto:
 * un cambio de estado pertenece a la cita que lo أدى, y un aviso a quien lo
 * recibió. Duplicar ahí el id de la empresa sería un segundo sitio donde puede
 * desincronizarse. Por eso se filtran por relación y no por columna.
 */
const entidades = [
  ["usuarios", "user", (id) => ({ businessId: id })],
  ["clientes", "client", (id) => ({ businessId: id })],
  ["categorías", "category", (id) => ({ businessId: id })],
  ["tareas", "task", (id) => ({ businessId: id })],
  ["disponibilidades", "availability", (id) => ({ businessId: id })],
  ["citas", "appointment", (id) => ({ businessId: id })],
  // Los eventos son de las citas de la empresa.
  ["eventos", "appointmentEvent", (id) => ({ appointment: { businessId: id } })],
  // Un aviso puede venir de una cita de la empresa o ser una notificación suelta
  // de uno de sus usuarios (las de alta de cuenta, por ejemplo).
  [
    "notificaciones",
    "notification",
    (id) => ({ OR: [{ appointment: { businessId: id } }, { user: { businessId: id } }] })
  ]
];

const negocios = await prisma.business.findMany({
  where: soloEste ? { slug: soloEste } : {},
  orderBy: { id: "asc" }
});

if (negocios.length === 0) {
  console.log(`\nNo hay ningún negocio con el identificador "${soloEste}".`);
  console.log("  node scripts/estado.js   para ver todos\n");
  await prisma.$disconnect();
  process.exit(0);
}

const totales = {};

for (const negocio of negocios) {
  const cabecera = `== ${negocio.nombre} (${negocio.slug}) · ${negocio.activo ? "activo" : "DESACTIVADO"} ==`;
  console.log(`\n${cabecera}\n${"=".repeat(cabecera.length)}\n`);

  for (const [etiqueta, modelo, donde] of entidades) {
    // El superadministrador no pertenece a ningún negocio, así que queda fuera
    // del recuento: se informa al final.
    const total = await prisma[modelo].count({ where: donde(negocio.id) });
    totales[etiqueta] = (totales[etiqueta] || 0) + total;
    console.log(`  ${etiqueta.padEnd(16)} ${String(total).padStart(3)}`);
  }

  const categorias = await prisma.category.findMany({
    where: { businessId: negocio.id },
    orderBy: { name: "asc" },
    select: { name: true }
  });
  console.log("\n  categorías: " + categorias.map((c) => c.name).join(", "));

  const disponibilidad = await prisma.availability.findMany({
    where: { businessId: negocio.id },
    orderBy: [{ date: "asc" }, { startTime: "asc" }]
  });
  console.log("\n  disponibilidad:");
  for (const hueco of disponibilidad) {
    console.log(
      `    ${dia(hueco.date)}  ${hueco.startTime}-${hueco.endTime}  ${hueco.status.padEnd(10)}` +
        (hueco.note ? `  ${hueco.note}` : "")
    );
  }

  const citas = await prisma.appointment.findMany({
    where: { businessId: negocio.id },
    include: { client: true, availability: true, task: true },
    orderBy: { id: "asc" }
  });
  console.log("\n  citas:");
  for (const cita of citas) {
    console.log(
      `    ${cita.client.nombre.padEnd(20)} ${cita.status.padEnd(12)} ${dia(cita.availability.date)} ${cita.availability.startTime}  ${cita.task.title}`
    );
  }

  const sinFecha = await prisma.task.count({ where: { businessId: negocio.id, dueDate: null } });
  console.log(`\n  tareas sin fecha (NULL de verdad): ${sinFecha}`);
}

const superadmins = await prisma.user.count({ where: { role: "SUPERADMIN" } });
console.log(`\n== Plataforma ==\n\n  superadministradores  ${String(superadmins).padStart(3)}  (no pertenecen a ningún negocio)`);

if (negocios.length > 1) {
  const lineas = entidades.map(
    ([etiqueta]) => `  ${etiqueta.padEnd(16)} ${String(totales[etiqueta] || 0).padStart(3)}`
  );
  console.log(`\n== Total (${negocios.length} negocios) ==\n\n${lineas.join("\n")}`);
}

await prisma.$disconnect();
console.log();
