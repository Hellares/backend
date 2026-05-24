-- =========================================================================
-- Caja Central (Tesoreria) por sede
-- =========================================================================
--
-- Cambios:
--   1. Caja.usuarioId pasa a NULLABLE (la central no tiene cajero asignado).
--   2. Caja.esCajaCentral BOOL DEFAULT false (marca la central perpetua).
--   3. Indice UNIQUE PARCIAL: una sola central por sede.
--   4. Indice de soporte: (sedeId, esCajaCentral) para queries de tesoreria.
--   5. 4 valores nuevos en CategoriaMovimientoCaja:
--        DEPOSITO_TESORERIA   barrido al cerrar caja operativa
--        RETIRO_TESORERIA     egreso desde la central
--        AJUSTE_TESORERIA     correcciones manuales del admin
--        REVERSO_CAJA_CERRADA contrapartida de anular venta de caja cerrada
--
-- Compatibilidad: cambio aditivo. Cajas existentes mantienen usuarioId NOT
-- NULL en la practica (los inserts hechos hasta ahora lo pusieron). La
-- central nace vacia (S/0) la primera vez que se necesita.
-- =========================================================================

-- AlterTable
ALTER TABLE "Caja" ALTER COLUMN "usuarioId" DROP NOT NULL;

ALTER TABLE "Caja" ADD COLUMN "esCajaCentral" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Caja_sedeId_esCajaCentral_idx" ON "Caja"("sedeId", "esCajaCentral");

-- CreateIndex (UNIQUE PARCIAL: una sola Caja Central por sede)
CREATE UNIQUE INDEX "Caja_central_por_sede_unique" ON "Caja"("sedeId") WHERE "esCajaCentral" = true;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'DEPOSITO_TESORERIA';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'RETIRO_TESORERIA';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'AJUSTE_TESORERIA';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'REVERSO_CAJA_CERRADA';
