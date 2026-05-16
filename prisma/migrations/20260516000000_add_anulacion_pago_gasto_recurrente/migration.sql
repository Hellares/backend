-- AlterTable: agregar campos de anulación
ALTER TABLE "PagoGastoRecurrente"
  ADD COLUMN "anulado"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoAnulacion" TEXT,
  ADD COLUMN "anuladoPorId"    TEXT,
  ADD COLUMN "fechaAnulacion"  TIMESTAMP(3);

-- DropIndex: el unique simple no respeta anulado; lo reemplazamos por uno parcial
DROP INDEX "PagoGastoRecurrente_gastoRecurrenteId_periodo_key";

-- CreateIndex: unique parcial — solo bloquea duplicados entre pagos NO anulados,
-- así un pago anulado libera el período y permite registrar el correcto.
CREATE UNIQUE INDEX "PagoGastoRecurrente_gastoRecurrenteId_periodo_active_key"
  ON "PagoGastoRecurrente"("gastoRecurrenteId", "periodo")
  WHERE "anulado" = false;

-- CreateIndex: filtro común
CREATE INDEX "PagoGastoRecurrente_anulado_idx" ON "PagoGastoRecurrente"("anulado");

-- AddForeignKey: anuladoPorId → Usuario
ALTER TABLE "PagoGastoRecurrente"
  ADD CONSTRAINT "PagoGastoRecurrente_anuladoPorId_fkey"
  FOREIGN KEY ("anuladoPorId") REFERENCES "Usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
