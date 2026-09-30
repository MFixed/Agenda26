import { PrismaClient } from "@prisma/client";

/**
 * Cliente de Prisma compartido.
 *
 * Una sola instancia en todo el proceso: Prisma gestiona internamente el pool de
 * conexiones, y abrir varias dejaría conexiones abiertas de sobra.
 */
export const prisma = new PrismaClient();
