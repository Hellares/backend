-- CreateEnum
CREATE TYPE "TipoOperacionAgente" AS ENUM ('DEPOSITO', 'RETIRO');

-- CreateEnum
CREATE TYPE "EstadoAgenteBancario" AS ENUM ('ACTIVO', 'INACTIVO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'DEPOSITO_AGENTE';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'RETIRO_AGENTE';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'COMISION_AGENTE';

-- DropIndex
DROP INDEX "Producto_descripcion_trgm_idx";

-- DropIndex
DROP INDEX "Producto_nombre_trgm_idx";

-- CreateTable
CREATE TABLE "AgenteBancario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "codigoAgente" TEXT,
    "fondoAsignado" DECIMAL(10,2) NOT NULL,
    "saldoActual" DECIMAL(10,2) NOT NULL,
    "comisionDeposito" DECIMAL(10,2) NOT NULL DEFAULT 1.50,
    "comisionRetiro" DECIMAL(10,2) NOT NULL DEFAULT 1.50,
    "responsableId" TEXT,
    "estado" "EstadoAgenteBancario" NOT NULL DEFAULT 'ACTIVO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgenteBancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperacionAgente" (
    "id" TEXT NOT NULL,
    "agenteBancarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoOperacionAgente" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "comision" DECIMAL(10,2) NOT NULL,
    "nombreCliente" TEXT,
    "documentoCliente" TEXT,
    "numeroOperacion" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "observaciones" TEXT,
    "fechaOperacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movimientoCajaId" TEXT,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperacionAgente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgenteBancario_empresaId_idx" ON "AgenteBancario"("empresaId");

-- CreateIndex
CREATE INDEX "AgenteBancario_empresaId_sedeId_idx" ON "AgenteBancario"("empresaId", "sedeId");

-- CreateIndex
CREATE INDEX "AgenteBancario_estado_idx" ON "AgenteBancario"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "AgenteBancario_empresaId_sedeId_banco_key" ON "AgenteBancario"("empresaId", "sedeId", "banco");

-- CreateIndex
CREATE INDEX "OperacionAgente_agenteBancarioId_idx" ON "OperacionAgente"("agenteBancarioId");

-- CreateIndex
CREATE INDEX "OperacionAgente_empresaId_idx" ON "OperacionAgente"("empresaId");

-- CreateIndex
CREATE INDEX "OperacionAgente_fechaOperacion_idx" ON "OperacionAgente"("fechaOperacion");

-- CreateIndex
CREATE INDEX "OperacionAgente_agenteBancarioId_fechaOperacion_idx" ON "OperacionAgente"("agenteBancarioId", "fechaOperacion");

-- CreateIndex
CREATE INDEX "OperacionAgente_tipo_idx" ON "OperacionAgente"("tipo");

-- AddForeignKey
ALTER TABLE "AgenteBancario" ADD CONSTRAINT "AgenteBancario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgenteBancario" ADD CONSTRAINT "AgenteBancario_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgenteBancario" ADD CONSTRAINT "AgenteBancario_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacionAgente" ADD CONSTRAINT "OperacionAgente_agenteBancarioId_fkey" FOREIGN KEY ("agenteBancarioId") REFERENCES "AgenteBancario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacionAgente" ADD CONSTRAINT "OperacionAgente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacionAgente" ADD CONSTRAINT "OperacionAgente_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperacionAgente" ADD CONSTRAINT "OperacionAgente_movimientoCajaId_fkey" FOREIGN KEY ("movimientoCajaId") REFERENCES "MovimientoCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

