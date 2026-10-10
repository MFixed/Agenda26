import { createApp } from './src/server.js';
import { env } from './config/env.js';
import { prisma } from './config/driver.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${env.port} ya esta en uso.`);
    process.exit(1);
  }

  throw err;
});

// Cierre ordenado: primero se deja de aceptar conexiones, luego se cierra el pool.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} recibido, cerrando...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}