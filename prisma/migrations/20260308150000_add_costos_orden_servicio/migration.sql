-- AlterTable
ALTER TABLE "OrdenServicio" ADD COLUMN "costoTotal" DECIMAL(10,2),
ADD COLUMN "adelanto" DECIMAL(10,2),
ADD COLUMN "descuento" DECIMAL(10,2),
ADD COLUMN "metodoPagoAdelanto" TEXT;
