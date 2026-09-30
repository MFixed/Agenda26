/**
 * Estado actual de la base de datos: cuántos registros hay de cada entidad y
 * cómo quedaron las disponibilidades y las citas del seed.
 *
 *   node scripts/estado.js
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dia = (fecha) => fecha.toISOString().slice(0, 10);

const entidades = [
  ["usuarios", "user"],
  ["clientes", "client"],
  ["categorías", "category"],
  ["tareas", "task"],
  ["disponibilidades", "availability"],
  ["citas", "appointment"],
  ["eventos", "appointmentEvent"],
  ["notificaciones", "notification"]
];

console.log("\n== Contenido de la base ==\n");
for (const [etiqueta, modelo] of entidades) {
  const total = await prisma[modelo].count();
  console.log(`  ${etiqueta.padEnd(16)} ${String(total).padStart(3)}`);
}

const categorias = await prisma.category.findMany({ orderBy: { name: "asc" } });
console.log("\n  categorías: " + categorias.map((c) => c.name).join(", "));

const disponibilidad = await prisma.availability.findMany({
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
  include: { client: true, availability: true, task: true },
  orderBy: { id: "asc" }
});
console.log("\n  citas:");
for (const cita of citas) {
  console.log(
    `    ${cita.client.nombre.padEnd(20)} ${cita.status.padEnd(12)} ${dia(cita.availability.date)} ${cita.availability.startTime}  ${cita.task.title}`
  );
}

const sinFecha = await prisma.task.count({ where: { dueDate: null } });
console.log(`\n  tareas sin fecha (NULL de verdad): ${sinFecha}`);

await prisma.$disconnect();
console.log();
