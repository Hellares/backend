-- Misma snapshot de unidad de compra que CompraDetalle pero a nivel
-- OrdenCompraDetalle. Se propaga al CompraDetalle cuando se recibe
-- mercadería desde la OC.

ALTER TABLE "OrdenCompraDetalle"
  ADD COLUMN "usaUnidadCompra" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cantidadOriginal" DECIMAL(12, 4),
  ADD COLUMN "unidadOriginalSimbolo" TEXT,
  ADD COLUMN "factorAplicado" DECIMAL(12, 4);
