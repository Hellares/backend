-- Cobro de órdenes de servicio vía Venta Rápida (POS).
-- VentaDetalle.ordenServicioId: la línea de venta representa el saldo de una
-- OrdenServicio. UNIQUE = candado anti doble cobro a nivel BD (la anulación
-- de la venta desvincula con SET NULL para que la orden vuelva a ser cobrable).

-- AlterTable
ALTER TABLE "VentaDetalle" ADD COLUMN "ordenServicioId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "VentaDetalle_ordenServicioId_key" ON "VentaDetalle"("ordenServicioId");

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_ordenServicioId_fkey" FOREIGN KEY ("ordenServicioId") REFERENCES "OrdenServicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
