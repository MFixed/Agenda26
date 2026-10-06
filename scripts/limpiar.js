/**
 * Deja la base de datos limpia para empezar una prueba desde cero.
 *
 *   node scripts/limpiar.js            borra los datos y deja el esquema listo
 *   node scripts/limpiar.js --seed     borra los datos y recarga el seed
 *
 * No borra el fichero de la base: se vacían las tablas. SQLite lo mantiene
 * abierto mientras el servidor está arrancado, y en Windows borrarlo falla con
 * EBUSY. El resultado es el mismo y así funciona con el servidor en marcha.
 */
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentos = process.argv.slice(2);
const conSeed = argumentos.includes("--seed");

if (argumentos.includes("--sin-seed")) {
  console.error("Usa --seed o nada; --sin-seed ya es el comportamiento por defecto.");
  process.exit(1);
}

/** Ejecuta un comando de Prisma. En Windows npx es un .cmd, por eso el shell. */
function ejecutar(args) {
  execFileSync("npx.cmd", args, { cwd: raiz, stdio: "inherit", shell: true });
}

console.log("\n== 1. Asegurando el esquema ==\n");
ejecutar(["prisma", "migrate", "deploy"]);

console.log("\n== 2. Vaciando las tablas ==\n");
const { prisma } = await import("../src/config/database.js");
// De hijos a padres, por las claves foráneas.
await prisma.notification.deleteMany();
await prisma.appointmentEvent.deleteMany();
await prisma.appointment.deleteMany();
await prisma.availability.deleteMany();
await prisma.task.deleteMany();
await prisma.category.deleteMany();
await prisma.client.deleteMany();
// Los negocios van después de todo lo que cuelga de ellos: cada uno arrastra en
// cascada usuarios, clientes, citas y horarios, así que basta con borrarlos.
await prisma.business.deleteMany();
await prisma.user.deleteMany();
await prisma.$disconnect();
console.log("  negocios, usuarios, clientes, categorías, tareas, disponibilidad,");
console.log("  citas, eventos y notificaciones: a cero");

// El secreto JWT también se va: si no, las sesiones viejas siguen valiendo.
const secreto = path.join(raiz, "data", ".jwt-secret");
if (existsSync(secreto)) {
  unlinkSync(secreto);
  console.log("  borrado: data/.jwt-secret (las sesiones anteriores dejan de valer)");
}

if (conSeed) {
  console.log("\n== 3. Cargando el seed ==\n");
  ejecutar(["prisma", "db", "seed"]);
} else {
  console.log("\nBase de datos vacía.");
  console.log("  npm run db:seed            para cargar los datos de ejemplo");
  console.log("  npm run reset -- --seed    para hacerlo todo de golpe\n");
}
