-- CreateEnum
CREATE TYPE "FuenteIngreso" AS ENUM ('TESORERIA', 'CAJA', 'BANCO');

-- AlterTable
ALTER TABLE "PagoVenta"
  ADD COLUMN "fuente" "FuenteIngreso",
  ADD COLUMN "bancoId" TEXT,
  ADD COLUMN "movimientoCajaId" TEXT,
  ADD COLUMN "anulado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoAnulacion" TEXT,
  ADD COLUMN "anuladoPorId" TEXT,
  ADD COLUMN "fechaAnulacion" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PagoVenta_movimientoCajaId_key" ON "PagoVenta"("movimientoCajaId");

-- CreateIndex
CREATE INDEX "PagoVenta_bancoId_idx" ON "PagoVenta"("bancoId");

-- AddForeignKey
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "EmpresaBanco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoVenta" ADD CONSTRAINT "PagoVenta_movimientoCajaId_fkey" FOREIGN KEY ("movimientoCajaId") REFERENCES "MovimientoCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;
