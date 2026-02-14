-- AddXorConstraintProductoStock
-- Garantiza que exactamente uno de productoId o varianteId tenga valor (XOR)

ALTER TABLE "ProductoStock" ADD CONSTRAINT "ProductoStock_xor_producto_variante"
CHECK (
  ("productoId" IS NOT NULL AND "varianteId" IS NULL)
  OR ("productoId" IS NULL AND "varianteId" IS NOT NULL)
);
