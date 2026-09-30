import { crearApp } from "./app.js";
import { config } from "./config/index.js";
import { prisma } from "./config/database.js";

const app = crearApp();

const server = app.listen(config.port, () => {
  console.log(`Gestión de citas · http://localhost:${config.port}`);
  console.log(`  admin@ejemplo.com / Admin1234`);
  console.log(`  ana@ejemplo.com   / Cliente1234`);
});

/** Apagado limpio: se cierra el servidor y la conexión de Prisma. */
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
