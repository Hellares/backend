
-- CreateEnum
CREATE TYPE "ReservaCotizacionEstado" AS ENUM ('ACTIVA', 'LIBERADA', 'CONVERTIDA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'ADELANTO_COTIZACION';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'DEVOLUCION_ADELANTO_COTIZACION';

-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "adelantoMonto" DECIMAL(10,2),
ADD COLUMN     "movimientoCajaId" TEXT;

-- AlterTable
ALTER TABLE "CotizacionDetalle" ADD COLUMN     "cantidadReservada" INTEGER,
ADD COLUMN     "productoStockId" TEXT,
ADD COLUMN     "reservaEstado" "ReservaCotizacionEstado";

-- AlterTable
ALTER TABLE "MovimientoCaja" ADD COLUMN     "cotizacionId" TEXT;

-- AlterTable
ALTER TABLE "ProductoStock" ADD COLUMN     "stockReservadoCotizacion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CotizacionDetalle_productoStockId_idx" ON "CotizacionDetalle"("productoStockId");

-- CreateIndex
CREATE INDEX "CotizacionDetalle_cotizacionId_reservaEstado_idx" ON "CotizacionDetalle"("cotizacionId", "reservaEstado");

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionDetalle" ADD CONSTRAINT "CotizacionDetalle_productoStockId_fkey" FOREIGN KEY ("productoStockId") REFERENCES "ProductoStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

