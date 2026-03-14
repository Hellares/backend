-- AlterTable: Add cost fields to Cita
ALTER TABLE "Cita" ADD COLUMN "costoServicio" DECIMAL(10,2);
ALTER TABLE "Cita" ADD COLUMN "costoProductos" DECIMAL(10,2);
ALTER TABLE "Cita" ADD COLUMN "descuento" DECIMAL(10,2);
ALTER TABLE "Cita" ADD COLUMN "adelanto" DECIMAL(10,2);
ALTER TABLE "Cita" ADD COLUMN "costoTotal" DECIMAL(10,2);
ALTER TABLE "Cita" ADD COLUMN "metodoPagoAdelanto" TEXT;
