-- Unidad de Compra para productos: permite comprar al proveedor en una
-- unidad distinta a la de venta/stock (ej: PAQUETE de 100 BOLSAS).
-- El factor convierte automáticamente a unidad atómica en compras.

ALTER TABLE "Producto"
  ADD COLUMN "unidadCompraId" TEXT,
  ADD COLUMN "factorCompra" DECIMAL(12, 4);

ALTER TABLE "Producto"
  ADD CONSTRAINT "Producto_unidadCompraId_fkey"
  FOREIGN KEY ("unidadCompraId") REFERENCES "EmpresaUnidadMedida"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Producto_unidadCompraId_idx" ON "Producto"("unidadCompraId");

-- Snapshot de la unidad de compra usada en cada línea de compra.
-- Mantiene trazabilidad sin alterar los campos de cálculo.
ALTER TABLE "CompraDetalle"
  ADD COLUMN "usaUnidadCompra" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cantidadOriginal" DECIMAL(12, 4),
  ADD COLUMN "unidadOriginalSimbolo" TEXT,
  ADD COLUMN "factorAplicado" DECIMAL(12, 4);
