-- Compra de tickets en bloque (tipo SORTEO): "quiero 20 tickets" crea 20
-- participaciones con el mismo compraId — un pago, validación en bloque
-- con tickets consecutivos y una sola confirmación de WhatsApp.
ALTER TABLE "SorteoParticipante" ADD COLUMN "compraId" TEXT;
CREATE INDEX "SorteoParticipante_compraId_idx" ON "SorteoParticipante"("compraId");
