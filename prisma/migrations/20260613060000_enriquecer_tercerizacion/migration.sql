-- Enriquecer tercerización B2B:
--  (1) snapshot de "datos adicionales" denormalizados ({etiqueta,valor,tipo}) en la
--      tercerización, para que la empresa destino los renderice sin tener la
--      config CampoServicio del origen.
--  (2) bitácora append-only (TercerizacionNota) compartida origen↔destino:
--      apuntes, requerimientos y cambios de estado (historial, no chat realtime).

-- AlterTable: snapshot de datos adicionales
ALTER TABLE "TercerizacionServicio" ADD COLUMN "datosAdicionales" JSONB;

-- CreateEnum
CREATE TYPE "TipoNotaTercerizacion" AS ENUM ('NOTA', 'REQUERIMIENTO', 'CAMBIO_ESTADO', 'SISTEMA');

-- CreateTable
CREATE TABLE "TercerizacionNota" (
    "id" TEXT NOT NULL,
    "tercerizacionId" TEXT NOT NULL,
    "empresaAutorId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "tipo" "TipoNotaTercerizacion" NOT NULL DEFAULT 'NOTA',
    "contenido" TEXT NOT NULL,
    "metadata" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TercerizacionNota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TercerizacionNota_tercerizacionId_creadoEn_idx" ON "TercerizacionNota"("tercerizacionId", "creadoEn");

-- AddForeignKey
ALTER TABLE "TercerizacionNota" ADD CONSTRAINT "TercerizacionNota_tercerizacionId_fkey" FOREIGN KEY ("tercerizacionId") REFERENCES "TercerizacionServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
