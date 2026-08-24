-- Gastos de compra (flete, movilidad, interés) + su prorrateo al costo.
--
-- ADITIVA: todo lo nuevo tiene DEFAULT, así que las compras existentes quedan
-- exactamente como estaban (totalGastos = 0, gastoProrrateado = 0) y el código
-- viejo sigue funcionando hasta que la UI empiece a mandar gastos.
--
-- Escrita a mano y NO con `prisma migrate dev`: ese comando dropea los índices
-- GIN trigram que Compra y compañía tienen creados con SQL crudo.

-- CreateEnum
CREATE TYPE "CriterioProrrateo" AS ENUM ('VALOR', 'CANTIDAD');

-- AlterTable
ALTER TABLE "Compra" ADD COLUMN "totalGastos" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CompraDetalle" ADD COLUMN "gastoProrrateado" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CompraGasto" (
    "id" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "porcentajeIGV" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igv" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "base" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "prorratea" BOOLEAN NOT NULL DEFAULT true,
    "criterio" "CriterioProrrateo" NOT NULL DEFAULT 'VALOR',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompraGasto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompraGasto_compraId_idx" ON "CompraGasto"("compraId");

-- AddForeignKey
ALTER TABLE "CompraGasto" ADD CONSTRAINT "CompraGasto_compraId_fkey"
    FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
