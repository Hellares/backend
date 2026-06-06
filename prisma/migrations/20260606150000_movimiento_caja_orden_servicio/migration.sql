-- Adelantos de órdenes de servicio registrados en caja (ADELANTO_SERVICIO).
-- MovimientoCaja.ordenServicioId: trazabilidad orden ↔ movimientos (ingresos
-- por delta de adelanto y egresos de corrección), mismo patrón que cotizacionId.

-- AlterTable
ALTER TABLE "MovimientoCaja" ADD COLUMN "ordenServicioId" TEXT;

-- CreateIndex
CREATE INDEX "MovimientoCaja_ordenServicioId_idx" ON "MovimientoCaja"("ordenServicioId");

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_ordenServicioId_fkey" FOREIGN KEY ("ordenServicioId") REFERENCES "OrdenServicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
