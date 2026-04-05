-- AlterTable: Descuento global con autorización de supervisor
ALTER TABLE "Venta" ADD COLUMN "descuentoGlobal" DECIMAL(10,2);
ALTER TABLE "Venta" ADD COLUMN "descuentoGlobalPorcentaje" DECIMAL(5,2);
ALTER TABLE "Venta" ADD COLUMN "descuentoAutorizadoPorId" TEXT;
ALTER TABLE "Venta" ADD COLUMN "descuentoAutorizadoEn" TIMESTAMP(3);

-- AlterEnum: AccionAudit
ALTER TYPE "AccionAudit" ADD VALUE 'DESCUENTO_AUTORIZADO';
