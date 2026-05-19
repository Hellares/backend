-- Ajuste opcional de precio venta al confirmar compra.
-- Si la línea trae nuevoPrecioVenta, al confirmar se actualiza
-- ProductoStock.precio y se registra en ProductoPrecioHistorialSede
-- con origenModulo=COMPRA + razón "Ajuste en compra COMPRA-XXX".

ALTER TABLE "CompraDetalle"
  ADD COLUMN "nuevoPrecioVenta" DECIMAL(14, 4);
