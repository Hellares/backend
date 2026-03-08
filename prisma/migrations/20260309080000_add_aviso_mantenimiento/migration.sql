-- CreateEnum
CREATE TYPE "EstadoAviso" AS ENUM ('PENDIENTE', 'NOTIFICADO', 'ATENDIDO', 'DESCARTADO');

-- CreateTable
CREATE TABLE "ConfiguracionAvisoMantenimiento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "intervalos" JSONB NOT NULL,
    "diasAnticipacion" INTEGER NOT NULL DEFAULT 7,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfiguracionAvisoMantenimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvisoMantenimiento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ordenServicioId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipoServicio" TEXT NOT NULL,
    "equipoDescripcion" TEXT,
    "fechaUltimoServicio" TIMESTAMP(3) NOT NULL,
    "fechaRecomendada" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoAviso" NOT NULL DEFAULT 'PENDIENTE',
    "ordenGeneradaId" TEXT,
    "notificadoEn" TIMESTAMP(3),
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AvisoMantenimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionAvisoMantenimiento_empresaId_key" ON "ConfiguracionAvisoMantenimiento"("empresaId");
CREATE INDEX "AvisoMantenimiento_empresaId_estado_idx" ON "AvisoMantenimiento"("empresaId", "estado");
CREATE INDEX "AvisoMantenimiento_fechaRecomendada_idx" ON "AvisoMantenimiento"("fechaRecomendada");
CREATE INDEX "AvisoMantenimiento_clienteId_idx" ON "AvisoMantenimiento"("clienteId");
CREATE INDEX "AvisoMantenimiento_ordenServicioId_idx" ON "AvisoMantenimiento"("ordenServicioId");

-- AddForeignKey
ALTER TABLE "ConfiguracionAvisoMantenimiento" ADD CONSTRAINT "ConfiguracionAvisoMantenimiento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvisoMantenimiento" ADD CONSTRAINT "AvisoMantenimiento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvisoMantenimiento" ADD CONSTRAINT "AvisoMantenimiento_ordenServicioId_fkey" FOREIGN KEY ("ordenServicioId") REFERENCES "OrdenServicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AvisoMantenimiento" ADD CONSTRAINT "AvisoMantenimiento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "EmpresaPersona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
