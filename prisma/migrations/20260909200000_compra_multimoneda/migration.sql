-- Compras en moneda extranjera: el documento vive en la moneda del proveedor,
-- el COSTO del inventario vive en soles, y la DEUDA se cancela al tipo de
-- cambio del dia de cada pago.
--
-- 1) Compra.totalSoles: `total` x `tipoCambio`, CONGELADO al confirmar. En una
--    compra en PEN es igual a `total`. El costo del inventario se mide al tipo
--    de cambio de la fecha de la transaccion y no se vuelve a tocar; si
--    siguiera al pago, pagar en noviembre cambiaria el costo de mercaderia ya
--    vendida en setiembre.
ALTER TABLE "Compra"
  ADD COLUMN "totalSoles" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: al 09-09-2026 TODAS las compras existentes son PEN (verificado en
-- prod y beta), asi que su equivalente en soles es su propio total.
UPDATE "Compra" SET "totalSoles" = "total";

-- 2) PagoCompra: separar lo que SALE de la fuente de lo que CANCELA de la deuda.
--    `monto` sigue siendo lo que sale (los soles de la caja, el saldo del
--    banco) y no se toca. `montoAplicado` es lo que cancela, en la moneda de
--    la compra, y queda NULL cuando las dos monedas coinciden: ahi `monto` ya
--    lo dice y el saldo sigue dando exactamente lo mismo que antes.
ALTER TABLE "PagoCompra"
  ADD COLUMN "montoAplicado" DECIMAL(12,2),
  ADD COLUMN "tipoCambio"    DECIMAL(10,4);
