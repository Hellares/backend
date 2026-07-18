-- Pago de api-yape CONSUMIDO por la participación al validarla:
-- un mismo yape no puede validar/sugerirse dos veces.
ALTER TABLE "SorteoParticipante" ADD COLUMN "yapePaymentId" TEXT;
CREATE INDEX "SorteoParticipante_empresaId_yapePaymentId_idx"
  ON "SorteoParticipante"("empresaId", "yapePaymentId");
