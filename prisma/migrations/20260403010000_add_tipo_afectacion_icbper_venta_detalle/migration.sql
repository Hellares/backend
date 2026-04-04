-- AlterTable: agregar tipoAfectacion e icbper a VentaDetalle
ALTER TABLE "VentaDetalle" ADD COLUMN "tipoAfectacion" TEXT NOT NULL DEFAULT '10';
ALTER TABLE "VentaDetalle" ADD COLUMN "icbper" DECIMAL(10,2) NOT NULL DEFAULT 0;
