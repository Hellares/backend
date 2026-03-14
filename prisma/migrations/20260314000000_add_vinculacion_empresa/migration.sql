-- CreateEnum
CREATE TYPE "EstadoVinculacion" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA', 'DESVINCULADA');

-- AlterTable
ALTER TABLE "ClienteEmpresa" ADD COLUMN     "empresaVinculadaId" TEXT;

-- CreateTable
CREATE TABLE "VinculacionEmpresa" (
    "id" TEXT NOT NULL,
    "empresaSolicitanteId" TEXT NOT NULL,
    "empresaVinculadaId" TEXT NOT NULL,
    "clienteEmpresaId" TEXT NOT NULL,
    "estado" "EstadoVinculacion" NOT NULL DEFAULT 'PENDIENTE',
    "mensaje" TEXT,
    "motivoRechazo" TEXT,
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaRespuesta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VinculacionEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VinculacionEmpresa_empresaVinculadaId_estado_idx" ON "VinculacionEmpresa"("empresaVinculadaId", "estado");

-- CreateIndex
CREATE INDEX "VinculacionEmpresa_clienteEmpresaId_idx" ON "VinculacionEmpresa"("clienteEmpresaId");

-- CreateIndex
CREATE UNIQUE INDEX "VinculacionEmpresa_empresaSolicitanteId_empresaVinculadaId_key" ON "VinculacionEmpresa"("empresaSolicitanteId", "empresaVinculadaId");

-- AddForeignKey
ALTER TABLE "ClienteEmpresa" ADD CONSTRAINT "ClienteEmpresa_empresaVinculadaId_fkey" FOREIGN KEY ("empresaVinculadaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculacionEmpresa" ADD CONSTRAINT "VinculacionEmpresa_empresaSolicitanteId_fkey" FOREIGN KEY ("empresaSolicitanteId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculacionEmpresa" ADD CONSTRAINT "VinculacionEmpresa_empresaVinculadaId_fkey" FOREIGN KEY ("empresaVinculadaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculacionEmpresa" ADD CONSTRAINT "VinculacionEmpresa_clienteEmpresaId_fkey" FOREIGN KEY ("clienteEmpresaId") REFERENCES "ClienteEmpresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
