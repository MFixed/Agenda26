-- Multi-negocio: varios negocios independientes, cada uno con sus propios
-- administradores, clientes, categorías, tareas, disponibilidades y citas.
--
-- Los datos existentes se conservan: se meten en un negocio "principal"
-- (slug "principal") y luego el superadministrador puede crear negocios
-- nuevos y mover lo que haga falta manualmente.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERADMIN';

-- CreateTable
CREATE TABLE "Business" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- El negocio que recoge todo lo que ya hubiera antes de esta migración.
INSERT INTO "Business" ("nombre", "slug", "descripcion", "updatedAt")
VALUES ('Negocio principal', 'principal', 'Negocio heredado de antes de la separación multi-negocio.', CURRENT_TIMESTAMP);

-- AlterTable (nullable primero, para poder rellenar con el negocio por defecto)
ALTER TABLE "User" ADD COLUMN "businessId" INTEGER;
ALTER TABLE "Client" ADD COLUMN "businessId" INTEGER;
ALTER TABLE "Category" ADD COLUMN "businessId" INTEGER;
ALTER TABLE "Task" ADD COLUMN "businessId" INTEGER;
ALTER TABLE "Availability" ADD COLUMN "businessId" INTEGER;
ALTER TABLE "Appointment" ADD COLUMN "businessId" INTEGER;

-- Backfill: todo lo existente pasa a pertenecer al negocio principal.
UPDATE "User" SET "businessId" = (SELECT "id" FROM "Business" WHERE "slug" = 'principal');
UPDATE "Client" SET "businessId" = (SELECT "id" FROM "Business" WHERE "slug" = 'principal');
UPDATE "Category" SET "businessId" = (SELECT "id" FROM "Business" WHERE "slug" = 'principal');
UPDATE "Task" SET "businessId" = (SELECT "id" FROM "Business" WHERE "slug" = 'principal');
UPDATE "Availability" SET "businessId" = (SELECT "id" FROM "Business" WHERE "slug" = 'principal');
UPDATE "Appointment" SET "businessId" = (SELECT "id" FROM "Business" WHERE "slug" = 'principal');

-- User.businessId se queda nullable: el SUPERADMIN no tiene negocio.
ALTER TABLE "Client" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Availability" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Appointment" ALTER COLUMN "businessId" SET NOT NULL;

-- Las unicidades globales pasan a ser por negocio.
DROP INDEX "Client_documento_key";
DROP INDEX "Category_name_key";
DROP INDEX "Availability_date_startTime_key";

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE INDEX "Business_activo_idx" ON "Business"("activo");
CREATE INDEX "User_businessId_idx" ON "User"("businessId");
CREATE UNIQUE INDEX "Client_businessId_documento_key" ON "Client"("businessId", "documento");
CREATE INDEX "Client_businessId_idx" ON "Client"("businessId");
CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");
CREATE INDEX "Task_businessId_idx" ON "Task"("businessId");
CREATE INDEX "Availability_businessId_idx" ON "Availability"("businessId");
CREATE UNIQUE INDEX "Availability_businessId_date_startTime_key" ON "Availability"("businessId", "date", "startTime");
CREATE INDEX "Appointment_businessId_idx" ON "Appointment"("businessId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
