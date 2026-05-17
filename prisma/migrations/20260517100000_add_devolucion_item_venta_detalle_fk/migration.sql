-- =========================================
-- FK exacta DevolucionItem -> VentaDetalle
-- =========================================
--
-- Permite que el reporte de liquidaciones descuente la cantidad
-- devuelta del VentaDetalle exacto incluso cuando una venta tiene
-- varios detalles del mismo producto (caso raro pero posible).
-- Nullable porque devoluciones previas a esta migracion y reversiones
-- totales pueden no traerlo — el reporte cae a match por
-- (ventaId, productoId, varianteId) como fallback.

-- AlterTable
ALTER TABLE "DevolucionItem"
    ADD COLUMN "ventaDetalleId" TEXT;

-- CreateIndex
CREATE INDEX "DevolucionItem_ventaDetalleId_idx" ON "DevolucionItem"("ventaDetalleId");

-- AddForeignKey
ALTER TABLE "DevolucionItem" ADD CONSTRAINT "DevolucionItem_ventaDetalleId_fkey"
    FOREIGN KEY ("ventaDetalleId") REFERENCES "VentaDetalle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
