-- CreateEnum
CREATE TYPE "CanalVenta" AS ENUM ('POS', 'COTIZACION', 'ONLINE');

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN "canalVenta" "CanalVenta" NOT NULL DEFAULT 'POS';

-- Backfill: ventas con cotizacionId → COTIZACION
UPDATE "Venta" SET "canalVenta" = 'COTIZACION' WHERE "cotizacionId" IS NOT NULL;
