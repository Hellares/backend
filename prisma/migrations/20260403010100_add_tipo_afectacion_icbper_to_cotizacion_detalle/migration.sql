-- AlterTable: agregar tipoAfectacion e icbper a CotizacionDetalle
ALTER TABLE "CotizacionDetalle" ADD COLUMN "tipoAfectacion" TEXT NOT NULL DEFAULT '10';
ALTER TABLE "CotizacionDetalle" ADD COLUMN "icbper" DECIMAL(10,2) NOT NULL DEFAULT 0;
