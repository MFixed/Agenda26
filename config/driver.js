import { PrismaClient } from '@prisma/client';

/**
 * Unica instancia del cliente de ORM. Express recarga los modulos en modo
 * watch y un cliente por recarga abriria demasiadas conexiones.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

globalForPrisma.prisma = prisma;