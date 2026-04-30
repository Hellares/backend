-- Reversión total post-anulación: campos para Devolucion + valor ANULADA en EstadoCuota.
-- Devolucion.esReversionTotal=true marca la devolución generada cuando el comprobante
-- y todas sus notas ya fueron anulados ante SUNAT. cajeroOriginalId permite trazar al
-- cajero que registró la venta original. pendienteRegistroCaja queda true cuando un
-- admin/supervisor procesa sin caja abierta (ajuste manual de tesorería pendiente).

ALTER TABLE "Devolucion"
  ADD COLUMN "esReversionTotal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cajeroOriginalId" TEXT,
  ADD COLUMN "pendienteRegistroCaja" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Devolucion_ventaId_esReversionTotal_idx"
  ON "Devolucion"("ventaId", "esReversionTotal");

CREATE INDEX "Devolucion_cajeroOriginalId_idx"
  ON "Devolucion"("cajeroOriginalId");

ALTER TABLE "Devolucion"
  ADD CONSTRAINT "Devolucion_cajeroOriginalId_fkey"
  FOREIGN KEY ("cajeroOriginalId") REFERENCES "Usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Agregar valor ANULADA al enum EstadoCuota (cuotas canceladas por reversión total).
ALTER TYPE "EstadoCuota" ADD VALUE 'ANULADA';
