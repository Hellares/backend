-- Anulación (soft-delete) de pagos a proveedor: revertir el egreso y marcar.
ALTER TABLE "PagoCompra"
  ADD COLUMN "anulado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoAnulacion" TEXT,
  ADD COLUMN "anuladoPorId" TEXT,
  ADD COLUMN "fechaAnulacion" TIMESTAMP(3);
