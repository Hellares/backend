-- De qué lote viene la mercadería cuando cambió de sede (transferencia o
-- distribución de una compra). El lote de destino hereda vencimiento, costo y
-- proveedor del de origen; sin esto llegaba como un lote de ajuste sin fecha.
--
-- Aditiva: columna nullable + índice + FK a la misma tabla.
ALTER TABLE "Lote" ADD COLUMN "loteOrigenId" TEXT;

CREATE INDEX "Lote_loteOrigenId_idx" ON "Lote"("loteOrigenId");

ALTER TABLE "Lote" ADD CONSTRAINT "Lote_loteOrigenId_fkey"
  FOREIGN KEY ("loteOrigenId") REFERENCES "Lote"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
