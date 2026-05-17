-- =========================================
-- LIQUIDACIÓN (remate por debajo de costo) + SNAPSHOT DE COSTO
-- =========================================
--
-- Permite marcar productos como "EN LIQUIDACIÓN" con motivo y autorización
-- gerencial. Las ventas de productos en liquidación pueden tener margen
-- negativo sin requerir autorización adicional. Ventas con margen negativo
-- de productos NO en liquidación requieren ventaBajoCostoAutorizadaPorId
-- (rol GERENTE_SEDE / ADMINISTRADOR).
--
-- Snapshot de costo en VentaDetalle es deuda técnica necesaria para que
-- los reportes de margen históricos no se distorsionen cuando cambia el
-- precioCosto del producto. Backfill: 0 por default (las filas previas
-- no podrán reportar margen, pero las nuevas sí).

-- CreateEnum
CREATE TYPE "MotivoLiquidacion" AS ENUM ('FUERA_DE_CAMPANA', 'SIN_ROTACION', 'PROXIMO_A_VENCER', 'DESCONTINUADO', 'OTRO');

-- AlterEnum
ALTER TYPE "TipoCambioPrecio" ADD VALUE 'LIQUIDACION';

-- AlterTable: ProductoStock — campos de liquidación por sede
ALTER TABLE "ProductoStock"
    ADD COLUMN "enLiquidacion"              BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "precioLiquidacion"          DECIMAL(10,2),
    ADD COLUMN "motivoLiquidacion"          "MotivoLiquidacion",
    ADD COLUMN "observacionesLiquidacion"   TEXT,
    ADD COLUMN "fechaInicioLiquidacion"     TIMESTAMP(3),
    ADD COLUMN "fechaFinLiquidacion"        TIMESTAMP(3),
    ADD COLUMN "liquidacionAutorizadaPorId" TEXT;

-- AlterTable: Venta — autorización de venta bajo costo
ALTER TABLE "Venta"
    ADD COLUMN "ventaBajoCostoAutorizadaPorId" TEXT,
    ADD COLUMN "ventaBajoCostoAutorizadaEn"    TIMESTAMP(3),
    ADD COLUMN "perdidaTotalLineas"            DECIMAL(10,2);

-- AlterTable: VentaDetalle — snapshot costo + margen + motivo liquidación
ALTER TABLE "VentaDetalle"
    ADD COLUMN "precioCostoSnapshot"       DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "margenSnapshot"            DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "motivoLiquidacionSnapshot" "MotivoLiquidacion";

-- CreateIndex: ProductoStock
CREATE INDEX "ProductoStock_enLiquidacion_idx" ON "ProductoStock"("enLiquidacion");
CREATE INDEX "ProductoStock_enLiquidacion_fechaFinLiquidacion_idx" ON "ProductoStock"("enLiquidacion", "fechaFinLiquidacion");
CREATE INDEX "ProductoStock_sedeId_enLiquidacion_idx" ON "ProductoStock"("sedeId", "enLiquidacion");

-- CreateIndex: VentaDetalle
CREATE INDEX "VentaDetalle_motivoLiquidacionSnapshot_idx" ON "VentaDetalle"("motivoLiquidacionSnapshot");

-- AddForeignKey: ProductoStock.liquidacionAutorizadaPorId → Usuario.id
ALTER TABLE "ProductoStock" ADD CONSTRAINT "ProductoStock_liquidacionAutorizadaPorId_fkey"
    FOREIGN KEY ("liquidacionAutorizadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Venta.ventaBajoCostoAutorizadaPorId → Usuario.id
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_ventaBajoCostoAutorizadaPorId_fkey"
    FOREIGN KEY ("ventaBajoCostoAutorizadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
