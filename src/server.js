import { crearApp } from "./app.js";
import { config } from "./config/index.js";
import { diagnostico, prisma } from "./config/database.js";

const app = crearApp();

const server = app.listen(config.port, () => {
  // La dirección real la inyecta la plataforma: en Render es $PORT, que no
  // tiene por qué ser 3000. Imprimir localhost:malo confunde al que lee el
  // registro, que es la persona que tiene que depurarlo.
  console.log(`Gestión de citas escuchando en el puerto ${config.port} (${config.esProduccion ? "producción" : "desarrollo"})`);
  console.log(`  Estado del servicio: /api/health`);
  for (const aviso of config.avisos) {
    console.warn(`  AVISO: ${aviso}`);
  }
});

/**
 * Comprobación de arranque.
 *
 * La aplicación levanta igualmente aunque la base de datos no esté, para que las
 * páginas se sirvan y /api/health diga qué pasa. Lo que no puede ser es quedarse
 * callado: un 500 sin explicación en el registro durante un minuto de depuración
 * cuesta más que este mensaje.
 */
diagnostico().then((estado) => {
  if (estado.ok) {
    console.log(`  Base de datos lista (${estado.motor}, ${estado.usuarios} usuarios).`);
    return;
  }
  console.error("=".repeat(72));
  console.error(`  LA BASE DE DATOS NO ESTÁ LISTA: ${estado.problema}`);
  if (estado.detalle) {
    console.error(`  ${estado.detalle}`);
  }
  console.error(`  Cómo arreglarlo: ${estado.comoSeArregla}`);
  console.error("  GET /api/health devuelve este mismo diagnóstico con el estado 503.");
  console.error("=".repeat(72));
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
