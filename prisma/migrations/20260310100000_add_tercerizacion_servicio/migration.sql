-- CreateEnum
CREATE TYPE "OrigenOrden" AS ENUM ('CLIENTE_FINAL', 'B2B_RECIBIDO', 'B2B_ENVIADO');

-- CreateEnum
CREATE TYPE "EstadoTercerizacion" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'EN_PROCESO', 'COMPLETADO', 'CANCELADO');

-- AlterEnum
ALTER TYPE "EstadoOrdenServicio" ADD VALUE 'TERCERIZADO';

-- AlterTable Empresa: campos de tercerización
ALTER TABLE "Empresa" ADD COLUMN "aceptaTercerizacion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN "descripcionTercerizacion" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "tiposServicioTercerizacion" JSONB;

-- AlterTable OrdenServicio: origen de la orden
ALTER TABLE "OrdenServicio" ADD COLUMN "origenOrden" "OrigenOrden" NOT NULL DEFAULT 'CLIENTE_FINAL';

-- CreateTable
CREATE TABLE "TercerizacionServicio" (
    "id" TEXT NOT NULL,
    "empresaOrigenId" TEXT NOT NULL,
    "ordenOrigenId" TEXT NOT NULL,
    "empresaDestinoId" TEXT NOT NULL,
    "ordenDestinoId" TEXT,
    "estado" "EstadoTercerizacion" NOT NULL DEFAULT 'PENDIENTE',
    "datosEquipo" JSONB NOT NULL,
    "descripcionProblema" TEXT,
    "sintomas" JSONB,
    "componentesData" JSONB,
    "precioB2B" DECIMAL(10,2),
    "metodoPagoB2B" TEXT,
    "notasOrigen" TEXT,
    "notasDestino" TEXT,
    "motivoRechazo" TEXT,
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaRespuesta" TIMESTAMP(3),
    "fechaCompletado" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TercerizacionServicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TercerizacionServicio_ordenOrigenId_key" ON "TercerizacionServicio"("ordenOrigenId");
CREATE UNIQUE INDEX "TercerizacionServicio_ordenDestinoId_key" ON "TercerizacionServicio"("ordenDestinoId");
CREATE INDEX "TercerizacionServicio_empresaOrigenId_idx" ON "TercerizacionServicio"("empresaOrigenId");
CREATE INDEX "TercerizacionServicio_empresaDestinoId_idx" ON "TercerizacionServicio"("empresaDestinoId");
CREATE INDEX "TercerizacionServicio_estado_idx" ON "TercerizacionServicio"("estado");
CREATE INDEX "TercerizacionServicio_empresaOrigenId_estado_idx" ON "TercerizacionServicio"("empresaOrigenId", "estado");
CREATE INDEX "TercerizacionServicio_empresaDestinoId_estado_idx" ON "TercerizacionServicio"("empresaDestinoId", "estado");

-- CreateIndex on Empresa
CREATE INDEX "Empresa_aceptaTercerizacion_idx" ON "Empresa"("aceptaTercerizacion");

-- AddForeignKey
ALTER TABLE "TercerizacionServicio" ADD CONSTRAINT "TercerizacionServicio_empresaOrigenId_fkey" FOREIGN KEY ("empresaOrigenId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TercerizacionServicio" ADD CONSTRAINT "TercerizacionServicio_ordenOrigenId_fkey" FOREIGN KEY ("ordenOrigenId") REFERENCES "OrdenServicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TercerizacionServicio" ADD CONSTRAINT "TercerizacionServicio_empresaDestinoId_fkey" FOREIGN KEY ("empresaDestinoId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TercerizacionServicio" ADD CONSTRAINT "TercerizacionServicio_ordenDestinoId_fkey" FOREIGN KEY ("ordenDestinoId") REFERENCES "OrdenServicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
