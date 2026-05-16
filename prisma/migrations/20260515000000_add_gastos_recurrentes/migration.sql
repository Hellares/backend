-- CreateEnum
CREATE TYPE "FrecuenciaGasto" AS ENUM ('MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'ANUAL');

-- CreateEnum
CREATE TYPE "FuentePagoGasto" AS ENUM ('CAJA', 'BANCO');

-- CreateTable
CREATE TABLE "GastoRecurrente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT,
    "nombre" TEXT NOT NULL,
    "categoriaGastoId" TEXT NOT NULL,
    "proveedorId" TEXT,
    "montoEstimado" DECIMAL(10,2) NOT NULL,
    "frecuencia" "FrecuenciaGasto" NOT NULL,
    "diaVencimiento" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoPagoEn" TIMESTAMP(3),
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GastoRecurrente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoGastoRecurrente" (
    "id" TEXT NOT NULL,
    "gastoRecurrenteId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "montoReal" DECIMAL(10,2) NOT NULL,
    "fechaPago" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fuente" "FuentePagoGasto" NOT NULL,
    "metodoPago" "MetodoPagoVenta" NOT NULL,
    "bancoId" TEXT,
    "movimientoCajaId" TEXT,
    "comprobanteUrl" TEXT,
    "notas" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoGastoRecurrente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GastoRecurrente_empresaId_activo_idx" ON "GastoRecurrente"("empresaId", "activo");

-- CreateIndex
CREATE INDEX "GastoRecurrente_empresaId_sedeId_activo_idx" ON "GastoRecurrente"("empresaId", "sedeId", "activo");

-- CreateIndex
CREATE INDEX "GastoRecurrente_empresaId_diaVencimiento_idx" ON "GastoRecurrente"("empresaId", "diaVencimiento");

-- CreateIndex
CREATE INDEX "GastoRecurrente_categoriaGastoId_idx" ON "GastoRecurrente"("categoriaGastoId");

-- CreateIndex
CREATE INDEX "GastoRecurrente_proveedorId_idx" ON "GastoRecurrente"("proveedorId");

-- CreateIndex
CREATE UNIQUE INDEX "PagoGastoRecurrente_movimientoCajaId_key" ON "PagoGastoRecurrente"("movimientoCajaId");

-- CreateIndex
CREATE INDEX "PagoGastoRecurrente_empresaId_fechaPago_idx" ON "PagoGastoRecurrente"("empresaId", "fechaPago");

-- CreateIndex
CREATE INDEX "PagoGastoRecurrente_gastoRecurrenteId_fechaPago_idx" ON "PagoGastoRecurrente"("gastoRecurrenteId", "fechaPago");

-- CreateIndex
CREATE INDEX "PagoGastoRecurrente_empresaId_fuente_fechaPago_idx" ON "PagoGastoRecurrente"("empresaId", "fuente", "fechaPago");

-- CreateIndex
CREATE UNIQUE INDEX "PagoGastoRecurrente_gastoRecurrenteId_periodo_key" ON "PagoGastoRecurrente"("gastoRecurrenteId", "periodo");

-- AddForeignKey
ALTER TABLE "GastoRecurrente" ADD CONSTRAINT "GastoRecurrente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoRecurrente" ADD CONSTRAINT "GastoRecurrente_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoRecurrente" ADD CONSTRAINT "GastoRecurrente_categoriaGastoId_fkey" FOREIGN KEY ("categoriaGastoId") REFERENCES "CategoriaGasto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoRecurrente" ADD CONSTRAINT "GastoRecurrente_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoGastoRecurrente" ADD CONSTRAINT "PagoGastoRecurrente_gastoRecurrenteId_fkey" FOREIGN KEY ("gastoRecurrenteId") REFERENCES "GastoRecurrente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoGastoRecurrente" ADD CONSTRAINT "PagoGastoRecurrente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoGastoRecurrente" ADD CONSTRAINT "PagoGastoRecurrente_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "EmpresaBanco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoGastoRecurrente" ADD CONSTRAINT "PagoGastoRecurrente_movimientoCajaId_fkey" FOREIGN KEY ("movimientoCajaId") REFERENCES "MovimientoCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoGastoRecurrente" ADD CONSTRAINT "PagoGastoRecurrente_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
