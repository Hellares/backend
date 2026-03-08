-- AlterTable
ALTER TABLE "OrdenServicio" ADD COLUMN "cantidadReingresos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrdenServicio" ADD COLUMN "motivoReingreso" TEXT;
