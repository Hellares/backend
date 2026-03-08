-- AlterTable: Add aviso mantenimiento fields to OrdenServicio
ALTER TABLE "OrdenServicio" ADD COLUMN "incluirAvisoMantenimiento" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OrdenServicio" ADD COLUMN "fechaAvisoPersonalizado" TIMESTAMP(3);
