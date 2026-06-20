-- Marca si la compra está en el flujo de pagos (CxP). Backfill: las CONFIRMADAS
-- a crédito (no contado) que hoy aparecen en CxP → pagoPendiente=true. Las
-- contado quedan en false (se consideraban pagadas al confirmar).
ALTER TABLE "Compra" ADD COLUMN "pagoPendiente" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Compra"
SET "pagoPendiente" = true
WHERE "estado" = 'CONFIRMADA'
  AND "terminosPago" IS NOT NULL
  AND "terminosPago" <> 'CONTADO';
